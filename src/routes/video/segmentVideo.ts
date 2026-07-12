import { Request, Response } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import { VideoProcessor, ResolutionStep, FaceBlurStep } from "../../pipeline";

const MAX_SEGMENT_DURATION = 15; // seconds
const SCENE_THRESHOLD = 0.3;

function parseTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

interface SceneChange {
  pts_time: number;
}

export default async function segmentVideo(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project || !project.videoFilePath) {
      return res.status(400).json({ success: false, message: "项目不存在或未上传视频" });
    }

    const videoPath = oss.resolve(project.videoFilePath);
    const duration = project.videoDuration;
    if (!duration || duration <= 0) {
      return res.status(400).json({ success: false, message: "视频时长无效，请先分析视频" });
    }

    // Ensure reference video fits Seedance pixel bounds: 640×640 ~ 834×1,112
    let scaleFilter = "";
    try {
      const probeInput = `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`;
      const probeOut = JSON.parse(execSync(probeInput).toString());
      const videoStream = probeOut.streams.find((s: any) => s.codec_type === "video");
      if (videoStream?.width && videoStream?.height) {
        const sw = videoStream.width;
        const sh = videoStream.height;
        const pixels = sw * sh;
        const MIN_PIX = 409600;   // 640×640
        const MAX_PIX = 927408;   // 834×1,112
        const TARGET_DIM = 480;

        let scale: number | null = null;
        if (pixels < MIN_PIX || Math.min(sw, sh) < TARGET_DIM) {
          scale = Math.sqrt(Math.max(MIN_PIX / pixels, (TARGET_DIM * TARGET_DIM) / (sw * sh)));
        } else if (pixels > MAX_PIX) {
          scale = Math.sqrt(MAX_PIX / pixels);
        }
        if (scale !== null) {
          const tw = Math.ceil(sw * scale / 2) * 2;
          const th = Math.ceil(sh * scale / 2) * 2;
          scaleFilter = ` -vf "scale=${tw}:${th}:flags=lanczos"`;
          console.log(`[Segment] 分辨率调整: ${sw}x${sh} → ${tw}x${th}`);
        }
      }
    } catch {
      // ffprobe failed, skip scaling
    }

    // Detect scene changes using FFmpeg
    const sceneDetectCmd = `ffprobe -v quiet -show_entries frame=pts_time -of csv=p=0 -f lavfi "movie=${videoPath},select='gt(scene\\,${SCENE_THRESHOLD})'"`;
    let sceneTimes: number[] = [];
    try {
      const output = execSync(sceneDetectCmd, { timeout: 30000 }).toString().trim();
      if (output) {
        sceneTimes = output
          .split("\n")
          .map((line) => parseFloat(line.trim()))
          .filter((t) => !isNaN(t));
      }
    } catch {
      // Scene detection may fail on some videos, fall back to fixed intervals
    }

    // Build segments respecting the 15s limit
    const segments: Array<{ start: number; end: number }> = [];
    let currentStart = 0;
    let sceneIdx = 0;

    while (currentStart < duration) {
      let segmentEnd = Math.min(currentStart + MAX_SEGMENT_DURATION, duration);

      // Find nearest scene change within the window
      while (
        sceneIdx < sceneTimes.length &&
        sceneTimes[sceneIdx] <= currentStart
      ) {
        sceneIdx++;
      }

      if (
        sceneIdx < sceneTimes.length &&
        sceneTimes[sceneIdx] < segmentEnd &&
        sceneTimes[sceneIdx] > currentStart
      ) {
        // Split at scene change if it's not too close to the start
        if (sceneTimes[sceneIdx] - currentStart > 2) {
          segmentEnd = sceneTimes[sceneIdx];
        }
      }

      // Extend to scene change if it's just beyond the limit
      if (sceneIdx < sceneTimes.length) {
        const nextScene = sceneTimes[sceneIdx];
        if (nextScene > segmentEnd && nextScene - segmentEnd < 1) {
          segmentEnd = Math.min(nextScene, duration);
        }
      }

      segments.push({
        start: currentStart,
        end: Math.min(segmentEnd, duration),
      });
      currentStart = segmentEnd;
    }

    // Delete existing segments for this project
    await db("o_segment").where("projectId", projectId).del();

    // Create segment clips and DB records
    const segmentDir = oss.resolve(`project_${projectId}/segments`);
    if (!fs.existsSync(segmentDir)) {
      fs.mkdirSync(segmentDir, { recursive: true });
    }

    const emitSeg = (message: string) => {
      (req as any).app.get("io")?.to(`project:${projectId}`).emit("segment:progress", { message, step: "segment" });
    };

    const createdSegments = [];
    for (let i = 0; i < segments.length; i++) {
      emitSeg(`分段 ${i + 1}/${segments.length}...`);
      const { start, end } = segments[i];
      const segDuration = end - start;

      // Trim clip using FFmpeg
      const clipName = `segment_${i}.mp4`;
      const clipPath = path.join(segmentDir, clipName);
      const trimCmd = `ffmpeg -y -i "${videoPath}" -ss ${parseTime(start)} -t ${segDuration.toFixed(3)}${scaleFilter} -c:v libx264 -preset ultrafast -c:a aac "${clipPath}"`;
      execSync(trimCmd, { timeout: 60000 });

      // Extract a thumbnail frame
      const thumbName = `segment_${i}_thumb.jpg`;
      const thumbPath = path.join(segmentDir, thumbName);
      const thumbCmd = `ffmpeg -y -ss 0 -i "${clipPath}" -vframes 1 -q:v 2 "${thumbPath}"`;
      execSync(thumbCmd, { timeout: 10000 });

      const now = Date.now();
      const segId = now + i;

      await db("o_segment").insert({
        id: segId,
        projectId,
        startTime: start,
        endTime: end,
        duration: segDuration,
        sortOrder: i,
        imageGenState: "pending",
        videoGenState: "pending",
        createTime: now,
        updateTime: now,
      });

      // Create asset records
      await db("o_asset").insert({
        id: now + i + 10000,
        projectId,
        type: "segment_clip",
        fileName: clipName,
        filePath: `project_${projectId}/segments/${clipName}`,
        mimeType: "video/mp4",
        createTime: now,
      });

      const segRelativePath = `project_${projectId}/segments/${clipName}`;
      createdSegments.push({
        id: segId,
        startTime: start,
        endTime: end,
        duration: segDuration,
        sortOrder: i,
        clipPath: segRelativePath,
        thumbPath: `project_${projectId}/segments/${thumbName}`,
      });
    }

    // Update project status
    await db("o_project").where("id", projectId).update({
      status: "ready",
      updateTime: Date.now(),
    });

    // Run post-processing pipeline on each segment
    const io = (req as any).app.get("io");
    const emitGlobal = (message: string) => io?.to(`project:${projectId}`).emit("video:progress", { message, step: "pipeline", timestamp: Date.now() });
    await emitGlobal("正在处理视频分段...");

    // Check if face blur is enabled
    const fbSetting = await db("o_setting").where("key", "faceBlurEnabled").first();
    const faceBlurEnabled = fbSetting?.value === "true";

    const pipelineSteps = [new ResolutionStep()];
    if (faceBlurEnabled) {
      pipelineSteps.push(new FaceBlurStep());
      console.log("[Segment] 人脸马赛克已启用");
    }
    const pipeline = new VideoProcessor(pipelineSteps);
    for (const seg of createdSegments) {
      const segAbsPath = oss.resolve(seg.clipPath);
      try {
        const finalPath = await pipeline.processSegment({
          segmentId: seg.id,
          projectId,
          inputPath: segAbsPath,
          outputPath: segAbsPath, // steps create temp intermediates, final renamed to this
          onProgress: async (message) => {
            io?.to(`project:${projectId}`).emit("segment:progress", { segmentId: seg.id, message, timestamp: Date.now() });
          },
        });
        if (finalPath !== segAbsPath && fs.existsSync(finalPath)) {
          fs.renameSync(finalPath, segAbsPath);
        }
        io?.to(`project:${projectId}`).emit("segment:progress", { segmentId: seg.id, message: "处理完成", done: true });
      } catch (err: any) {
        console.error(`[Pipeline] segment ${seg.id} 处理失败: ${err.message}`);
        io?.to(`project:${projectId}`).emit("segment:progress", { segmentId: seg.id, message: `处理失败: ${err.message}`, error: true });
      }
    }

    res.json({
      success: true,
      data: {
        totalSegments: createdSegments.length,
        segments: createdSegments,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
