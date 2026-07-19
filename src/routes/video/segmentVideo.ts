import { Request, Response } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import { VideoProcessor, ResolutionStep, FaceBlurStep } from "../../pipeline";
import type { Step } from "../../pipeline";

const MAX_SEGMENT_DURATION = 15; // seconds (hard limit for all modes, AI video generation cap)
const SCENE_THRESHOLD = 0.3;
const MAX_SCENE_SEGMENT = 15; // seconds (for pure scene mode)
const MIN_DIALOGUE_SEGMENT = 5; // seconds
const MAX_DIALOGUE_SEGMENT = 15; // seconds
const DEFAULT_FIXED_INTERVAL = 10; // seconds

function parseTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

type SegmentBoundary = { start: number; end: number };

/**
 * Detect scene changes using FFmpeg's scene detection filter.
 * Returns array of timestamps (seconds) where scene changes occur.
 */
function detectSceneChanges(videoPath: string, threshold: number = SCENE_THRESHOLD): number[] {
  const cmd = `ffprobe -v quiet -show_entries frame=pts_time -of csv=p=0 -f lavfi "movie=${videoPath},select='gt(scene\\\\,${threshold})'"`;
  try {
    const output = execSync(cmd, { timeout: 30000 }).toString().trim();
    if (!output) return [];
    return output
      .split("\n")
      .map((line) => parseFloat(line.trim()))
      .filter((t) => !isNaN(t) && t > 0);
  } catch {
    return [];
  }
}

/**
 * Detect silence/dialogue pauses using FFmpeg's silencedetect filter.
 * Returns array of timestamps (seconds) at the midpoints of silence periods.
 */
function detectDialoguePauses(
  videoPath: string,
  noiseLevel: string = "-30dB",
  minSilenceDuration: number = 0.5
): number[] {
  const cmd = `ffmpeg -i "${videoPath}" -af "silencedetect=noise=${noiseLevel}:d=${minSilenceDuration}" -f null - 2>&1`;
  try {
    const output = execSync(cmd, { timeout: 60000 }).toString();
    const silenceEnds: number[] = [];
    const silenceRegex = /silence_end:\s+([\d.]+)/g;
    let match;
    while ((match = silenceRegex.exec(output)) !== null) {
      silenceEnds.push(parseFloat(match[1]));
    }
    return silenceEnds;
  } catch {
    return [];
  }
}

/**
 * Check if a video has an audio stream.
 */
function hasAudioStream(videoPath: string): boolean {
  try {
    const cmd = `ffprobe -v quiet -select_streams a -show_entries stream=index -of csv=p=0 "${videoPath}"`;
    const output = execSync(cmd, { timeout: 10000 }).toString().trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Mode 'auto' (default): scene detection + 15s max segment duration.
 * Same as the original behavior.
 */
function segmentByAuto(sceneTimes: number[], duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;
  let sceneIdx = 0;

  while (currentStart < duration) {
    let segmentEnd = Math.min(currentStart + MAX_SEGMENT_DURATION, duration);

    // Skip scene changes before current start
    while (sceneIdx < sceneTimes.length && sceneTimes[sceneIdx] <= currentStart) {
      sceneIdx++;
    }

    // Split at scene change if within window and not too close to start
    if (
      sceneIdx < sceneTimes.length &&
      sceneTimes[sceneIdx] < segmentEnd &&
      sceneTimes[sceneIdx] - currentStart > 2
    ) {
      segmentEnd = sceneTimes[sceneIdx];
    }

    // Extend to scene change if just beyond the limit
    if (sceneIdx < sceneTimes.length) {
      const nextScene = sceneTimes[sceneIdx];
      if (nextScene > segmentEnd && nextScene - segmentEnd < 1) {
        segmentEnd = Math.min(nextScene, duration);
      }
    }

    segments.push({ start: currentStart, end: Math.min(segmentEnd, duration) });
    currentStart = segmentEnd;
  }

  return segments;
}

/**
 * Mode 'scene': split purely at scene changes, with a max segment cap.
 * No 15s hard limit — scenes can be longer, but capped at MAX_SCENE_SEGMENT.
 */
function segmentByScene(sceneTimes: number[], duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;

  for (const sceneTime of sceneTimes) {
    if (sceneTime <= currentStart) continue;
    if (sceneTime >= duration) break;

    // If the gap since last split exceeds MAX_SCENE_SEGMENT, force a split
    // even without a scene change (prevent extreme long scenes)
    if (sceneTime - currentStart > MAX_SCENE_SEGMENT) {
      // Force split at MAX_SCENE_SEGMENT intervals
      let forcedEnd = currentStart + MAX_SCENE_SEGMENT;
      while (forcedEnd < sceneTime) {
        segments.push({ start: currentStart, end: forcedEnd });
        currentStart = forcedEnd;
        forcedEnd = currentStart + MAX_SCENE_SEGMENT;
      }
    }
    segments.push({ start: currentStart, end: sceneTime });
    currentStart = sceneTime;
  }

  // Final segment
  if (currentStart < duration) {
    // If the final segment is too long, split it
    while (duration - currentStart > MAX_SCENE_SEGMENT) {
      segments.push({ start: currentStart, end: currentStart + MAX_SCENE_SEGMENT });
      currentStart += MAX_SCENE_SEGMENT;
    }
    segments.push({ start: currentStart, end: duration });
  }

  return segments;
}

/**
 * Mode 'dialogue': split at silence/dialogue pauses.
 * Each segment between MIN_DIALOGUE_SEGMENT and MAX_DIALOGUE_SEGMENT.
 */
function segmentByDialogue(silenceTimes: number[], duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;
  let silenceIdx = 0;

  while (currentStart < duration) {
    // Find the best silence point within the allowable range
    let bestSplit = -1;
    while (
      silenceIdx < silenceTimes.length &&
      silenceTimes[silenceIdx] <= currentStart + MIN_DIALOGUE_SEGMENT
    ) {
      silenceIdx++;
    }

    // Look for a silence point that's MIN_DIALOGUE_SEGMENT away from start
    let candidateIdx = silenceIdx;
    while (
      candidateIdx < silenceTimes.length &&
      silenceTimes[candidateIdx] - currentStart <= MAX_DIALOGUE_SEGMENT
    ) {
      bestSplit = silenceTimes[candidateIdx];
      candidateIdx++;
    }

    let segmentEnd: number;
    if (bestSplit > 0) {
      segmentEnd = bestSplit;
      // Advance silenceIdx past the used split
      while (silenceIdx < silenceTimes.length && silenceTimes[silenceIdx] <= bestSplit) {
        silenceIdx++;
      }
    } else {
      segmentEnd = Math.min(currentStart + MAX_DIALOGUE_SEGMENT, duration);
    }

    segments.push({ start: currentStart, end: Math.min(segmentEnd, duration) });
    currentStart = segmentEnd;
  }

  return segments;
}

/**
 * Mode 'hybrid': combine scene changes and dialogue pauses, deduplicate.
 */
function segmentByHybrid(
  sceneTimes: number[],
  silenceTimes: number[],
  duration: number
): SegmentBoundary[] {
  // Merge and deduplicate all split points
  const allPoints = new Set<number>();
  for (const t of sceneTimes) {
    if (t > 0 && t < duration) allPoints.add(Math.round(t * 100) / 100);
  }
  for (const t of silenceTimes) {
    if (t > 0 && t < duration) allPoints.add(Math.round(t * 100) / 100);
  }
  const sorted = Array.from(allPoints).sort((a, b) => a - b);

  // Build segments from split points
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;
  for (const point of sorted) {
    if (point <= currentStart) continue;
    if (point - currentStart > MAX_SCENE_SEGMENT) {
      // Gap too large, insert forced splits
      let forcedEnd = currentStart + MAX_SCENE_SEGMENT;
      while (forcedEnd < point) {
        segments.push({ start: currentStart, end: forcedEnd });
        currentStart = forcedEnd;
        forcedEnd = currentStart + MAX_SCENE_SEGMENT;
      }
    }
    segments.push({ start: currentStart, end: point });
    currentStart = point;
  }
  if (currentStart < duration) {
    segments.push({ start: currentStart, end: duration });
  }

  return segments;
}

/**
 * Mode 'fixed': split at regular intervals.
 */
function segmentByFixed(duration: number, interval: number = DEFAULT_FIXED_INTERVAL): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;
  while (currentStart < duration) {
    const segmentEnd = Math.min(currentStart + interval, duration);
    segments.push({ start: currentStart, end: segmentEnd });
    currentStart = segmentEnd;
  }
  return segments;
}

/**
 * Parse custom segmentation string.
 * Format: "0,5|6,10"     = two segments: 0-5, 6-10
 *         "0,5|6,10|"    = three segments: 0-5, 6-10, rest
 *         "0,5|6,10|11," = three segments: 0-5, 6-10, 11-end
 */
function segmentByCustom(customRanges: string, duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  if (!customRanges) return segments;
  const parts = customRanges.split("|");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!p && i < parts.length - 1) continue;
    const [ss, se] = p.split(",");
    const start = parseFloat(ss);
    if (isNaN(start) || start < 0) continue;
    if (start >= duration) continue;
    if (se !== undefined && se.trim() !== "") {
      const end = parseFloat(se);
      if (isNaN(end) || end <= start) continue;
      segments.push({ start, end: Math.min(end, duration) });
    } else if (i === parts.length - 1) {
      segments.push({ start, end: duration });
    }
  }
  return segments;
}

export default async function segmentVideo(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const mode = req.body.mode || "auto";
    const fixedInterval = parseFloat(req.body.fixedInterval) || DEFAULT_FIXED_INTERVAL;
    const customRanges = req.body.customRanges || "";

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

    // Save segmentation mode to project
    await db("o_project").where("id", projectId).update({
      segmentationMode: mode,
      updateTime: Date.now(),
    });

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

    // Detect scene changes (used by auto, scene, hybrid modes)
    let sceneTimes: number[] = [];
    if (mode === "auto" || mode === "scene" || mode === "hybrid") {
      sceneTimes = detectSceneChanges(videoPath);
      console.log(`[Segment] 场景检测到 ${sceneTimes.length} 个切换点`);
    }

    // Detect dialogue pauses (used by dialogue, hybrid modes)
    let silenceTimes: number[] = [];
    if (mode === "dialogue" || mode === "hybrid") {
      const hasAudio = hasAudioStream(videoPath);
      if (hasAudio) {
        silenceTimes = detectDialoguePauses(videoPath);
        console.log(`[Segment] 对话检测到 ${silenceTimes.length} 个停顿点`);
      } else {
        console.log("[Segment] 视频无音频流，对话模式不可用，回退到 auto 模式");
        // Fall back to auto mode for no-audio videos
        return res.status(400).json({
          success: false,
          message: "该视频没有音频轨道，无法使用对话/混合分段模式。请选择其他分段方式。",
        });
      }
    }

    // Build segments based on the selected mode
    let segments: SegmentBoundary[];
    switch (mode) {
      case "scene":
        segments = segmentByScene(sceneTimes, duration);
        break;
      case "dialogue":
        segments = segmentByDialogue(silenceTimes, duration);
        break;
      case "hybrid":
        segments = segmentByHybrid(sceneTimes, silenceTimes, duration);
        break;
      case "fixed":
        segments = segmentByFixed(duration, fixedInterval);
        break;
      case "custom":
        segments = segmentByCustom(customRanges, duration);
        break;
      case "auto":
      default:
        segments = segmentByAuto(sceneTimes, duration);
        break;
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

    const pipelineSteps: Step[] = [new ResolutionStep()];
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
          outputPath: segAbsPath,
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
        mode,
        totalSegments: createdSegments.length,
        segments: createdSegments,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}