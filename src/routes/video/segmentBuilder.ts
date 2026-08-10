import { Request } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import { VideoProcessor, ResolutionStep, FaceBlurStep } from "../../pipeline";
import type { Step } from "../../pipeline";
import { parseTime } from "./segmenting";
import type { SegmentBoundary } from "./segmenting";

export interface SegmentRowMeta {
  prompt?: string;
  characterViewPath?: string | null;
  referenceFramePath?: string | null;
  splitPoints?: number[] | null;
}

export interface BuildSegmentClipsOptions {
  projectId: number;
  videoPath: string; // absolute source path
  boundaries: SegmentBoundary[];
  meta?: (SegmentRowMeta | null)[]; // aligned with boundaries; null/undefined → fresh row
  req: Request;
}

export interface BuiltSegment {
  id: number;
  startTime: number;
  endTime: number;
  duration: number;
  sortOrder: number;
  clipPath: string;
  thumbPath: string;
  splitPoints: number[] | null;
}

// Monotonic id base across sequential builds: segment ids = base + i, asset ids = base + i + 100000.
// Ensures no id reuse after the delete/reinsert cycle.
let _idBase = Date.now();
function nextIdBase(): number {
  _idBase = Math.max(_idBase + 1, Date.now());
  return _idBase;
}

/**
 * Carry over user-authored inputs from an existing segment row into a rebuilt
 * segment; generation outputs are deliberately reset (ids moved, clips re-cut).
 */
export function carryMeta(row: any): SegmentRowMeta {
  return {
    prompt: row.prompt,
    characterViewPath: row.characterViewPath,
    referenceFramePath: row.referenceFramePath,
    splitPoints: null,
  };
}

/**
 * Ensure reference video fits Seedance pixel bounds: 640×640 ~ 834×1,112.
 * Returns an ffmpeg scale filter string (or "" when no scaling is needed).
 */
export function computeScaleFilter(videoPath: string): string {
  let scaleFilter = "";
  try {
    const probeInput = `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`;
    const probeOut = JSON.parse(execSync(probeInput).toString());
    const videoStream = probeOut.streams.find((s: any) => s.codec_type === "video");
    if (videoStream?.width && videoStream?.height) {
      const sw = videoStream.width;
      const sh = videoStream.height;
      const pixels = sw * sh;
      const MIN_PIX = 409600; // 640×640
      const MAX_PIX = 927408; // 834×1,112
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
  return scaleFilter;
}

/**
 * Rebuild all segment clips for a project from the source video.
 * Deletes existing segments/assets/tasks, re-cuts every clip, and re-runs the
 * post-processing pipeline — the single writer of segment clips + DB rows.
 */
export async function buildSegmentClips(opts: BuildSegmentClipsOptions): Promise<BuiltSegment[]> {
  const { projectId, videoPath, boundaries, req } = opts;
  const meta = opts.meta ?? boundaries.map(() => null);

  // FK-safe cleanup: o_tasks references o_segment; delete it before segments.
  await db("o_tasks").where("projectId", projectId).del();
  await db("o_asset").where("projectId", projectId).where("type", "segment_clip").del();
  await db("o_segment").where("projectId", projectId).del();
  oss.deleteDirectory(`project_${projectId}/segments`);
  oss.deleteDirectory(`project_${projectId}/speech`);
  const segmentDir = oss.resolve(`project_${projectId}/segments`);
  fs.mkdirSync(segmentDir, { recursive: true });

  const scaleFilter = computeScaleFilter(videoPath);

  const emitSeg = (message: string) => {
    (req as any).app.get("io")?.to(`project:${projectId}`).emit("segment:progress", { message, step: "segment" });
  };

  const base = nextIdBase();
  const createdSegments: BuiltSegment[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    emitSeg(`分段 ${i + 1}/${boundaries.length}...`);
    const { start, end } = boundaries[i];
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
    const segId = base + i;
    const m = meta[i];

    await db("o_segment").insert({
      id: segId,
      projectId,
      startTime: start,
      endTime: end,
      duration: segDuration,
      sortOrder: i,
      prompt: m?.prompt ?? "",
      characterViewPath: m?.characterViewPath ?? null,
      referenceFramePath: m?.referenceFramePath ?? null,
      splitPoints: m?.splitPoints?.length ? JSON.stringify(m.splitPoints) : null,
      imageGenState: "pending",
      videoGenState: "pending",
      createTime: now,
      updateTime: now,
    });

    // Create asset records
    await db("o_asset").insert({
      id: base + i + 100000,
      projectId,
      type: "segment_clip",
      fileName: clipName,
      filePath: `project_${projectId}/segments/${clipName}`,
      mimeType: "video/mp4",
      createTime: now,
    });

    createdSegments.push({
      id: segId,
      startTime: start,
      endTime: end,
      duration: segDuration,
      sortOrder: i,
      clipPath: `project_${projectId}/segments/${clipName}`,
      thumbPath: `project_${projectId}/segments/${thumbName}`,
      splitPoints: m?.splitPoints?.length ? m.splitPoints : null,
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

  return createdSegments;
}
