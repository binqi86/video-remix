import { Request, Response } from "express";
import { execSync } from "child_process";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import path from "path";

interface FFprobeOutput {
  streams: Array<{
    codec_type: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
  }>;
  format: { duration?: string; size?: string };
}

export default async function analyzeVideo(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project || !project.videoFilePath) {
      return res.status(400).json({ success: false, message: "项目不存在或未上传视频" });
    }

    const io = (req as any).app.get("io");
    const emit = (message: string) => io?.to(`project:${projectId}`).emit("video:progress", { message, step: "analyze", timestamp: Date.now() });

    await emit("正在读取视频信息...");
    const videoPath = oss.resolve(project.videoFilePath);
    const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    const output = execSync(ffprobeCmd).toString();
    const info: FFprobeOutput = JSON.parse(output);

    // Extract video stream info
    const videoStream = info.streams.find((s) => s.codec_type === "video");
    let width = videoStream?.width || 0;
    let height = videoStream?.height || 0;
    const duration = parseFloat(info.format.duration || "0");
    const fps = videoStream?.r_frame_rate
      ? eval(videoStream.r_frame_rate)
      : 30;

    // Check if upscale to 480P is needed (Seedance 2.0 minimum requirement)
    const MIN_PX = 480;
    const MIN_PIXELS = 640 * 640; // Seedance requires at least 640x640 total pixels
    let upscaled = false;
    let upscaledRelative = "";

    if (width > 0 && height > 0) {
      const smaller = Math.min(width, height);
      const totalPixels = width * height;
      if (smaller < MIN_PX || totalPixels < MIN_PIXELS) {
        // Calculate target meet both min dimension and min pixel requirements
        const larger = Math.max(width, height);
        const aspectRatio = smaller / larger;
        const targetFromPixels = Math.ceil(Math.sqrt(MIN_PIXELS * aspectRatio));
        const targetDim = Math.max(MIN_PX, targetFromPixels);

        const isHorizontal = width > height;
        const scaleArg = isHorizontal
          ? `-1:${targetDim}`  // width auto, height = targetDim
          : `${targetDim}:-1`; // width = targetDim, height auto

        const ext = path.extname(project.videoFilePath);
        upscaledRelative = project.videoFilePath.replace(ext, `_480p${ext}`);
        const upscaledPath = oss.resolve(upscaledRelative);

        console.log(`[Video] 分辨率不足: ${width}x${height}，升频至 480P...`);
        await emit("分辨率不足，正在升频...");
        execSync(
          `ffmpeg -y -i "${videoPath}" -vf "scale=${scaleArg}:flags=lanczos" -c:v libx264 -preset fast -crf 23 -c:a copy "${upscaledPath}"`,
          { timeout: 300000 }
        );

        // Get new dimensions
        const probeCmd = `ffprobe -v quiet -print_format json -show_streams "${upscaledPath}"`;
        const probeOut = JSON.parse(execSync(probeCmd).toString());
        const newStream = probeOut.streams.find((s: any) => s.codec_type === "video");
        width = newStream?.width || width;
        height = newStream?.height || height;

        upscaled = true;
        console.log(`[Video] 升频完成: ${width}x${height}`);
      }
    }

    // Update project with video metadata
    await db("o_project").where("id", projectId).update({
      videoDuration: duration,
      videoWidth: width,
      videoHeight: height,
      videoFps: fps,
      status: "ready",
      updateTime: Date.now(),
    });

    // If upscaled, update the video file path in project
    if (upscaled) {
      await emit("升频完成");
      await db("o_project").where("id", projectId).update({
        videoFilePath: upscaledRelative,
        updateTime: Date.now(),
      });
    }

    await emit("视频分析完成");

    res.json({
      success: true,
      data: {
        duration,
        width,
        height,
        fps,
        size: parseInt(info.format.size || "0"),
        upscaled,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
