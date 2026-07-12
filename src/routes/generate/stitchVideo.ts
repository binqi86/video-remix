import { Request, Response } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function stitchVideo(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }

    const segments = await db("o_segment")
      .where("projectId", projectId)
      .where("videoGenState", "completed")
      .orderBy("sortOrder", "asc");

    if (segments.length === 0) {
      return res.status(400).json({ success: false, message: "没有已完成的视频分段" });
    }

    const taskId = Date.now();
    await db("o_tasks").insert({
      id: taskId,
      projectId,
      taskClass: "stitch",
      state: "进行中",
      startTime: Date.now(),
    });

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("generation:stitch:started", { projectId });

    // Build concat file
    const outputDir = oss.resolve(`project_${projectId}/output`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileListPath = path.join(outputDir, "filelist.txt");
    const fileLines = segments.map((s: any) => {
      const segPath = oss.resolve(s.videoGenPath || `project_${projectId}/generated-videos/segment_${s.sortOrder}_mock.mp4`);
      return `file '${segPath}'`;
    });
    fs.writeFileSync(fileListPath, fileLines.join("\n"));

    const outputFileName = `remixed_${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);

    // Run FFmpeg concat
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${fileListPath}" -c copy "${outputPath}"`;
    execSync(concatCmd, { timeout: 300000 });

    // Update project
    const outputRelativePath = `project_${projectId}/output/${outputFileName}`;
    await db("o_asset").insert({
      id: Date.now(),
      projectId,
      type: "stitched_output",
      fileName: outputFileName,
      filePath: outputRelativePath,
      mimeType: "video/mp4",
      createTime: Date.now(),
    });

    await db("o_project").where("id", projectId).update({
      status: "completed",
      updateTime: Date.now(),
    });

    await db("o_tasks").where("id", taskId).update({ state: "已完成" });

    io.to(`project:${projectId}`).emit("generation:stitch:completed", {
      projectId,
      outputUrl: `/oss/${outputRelativePath}`,
    });

    io.to(`project:${projectId}`).emit("generation:completed", { projectId });

    // Clean up temp file
    if (fs.existsSync(fileListPath)) {
      fs.unlinkSync(fileListPath);
    }

    res.json({
      success: true,
      data: {
        outputPath: outputRelativePath,
        outputUrl: `/oss/${outputRelativePath}`,
        totalSegments: segments.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
