import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function generateVideo(req: Request, res: Response) {
  try {
    const { segmentId } = req.body;
    if (!segmentId) {
      return res.status(400).json({ success: false, message: "缺少分段ID" });
    }

    const segment = await db("o_segment").where("id", segmentId).first();
    if (!segment) {
      return res.status(404).json({ success: false, message: "分段不存在" });
    }

    if (segment.imageGenState !== "completed") {
      return res.status(400).json({ success: false, message: "请先完成图像生成" });
    }

    await db("o_segment").where("id", segmentId).update({
      videoGenState: "generating",
      updateTime: Date.now(),
    });

    const taskId = Date.now();
    await db("o_tasks").insert({
      id: taskId,
      projectId: segment.projectId,
      segmentId,
      taskClass: "videoGen",
      state: "进行中",
      startTime: Date.now(),
    });

    const io = req.app.get("io");
    io.to(`project:${segment.projectId}`).emit("generation:segment:videoStarted", {
      projectId: segment.projectId,
      segmentId,
    });

    // Mock: In production, call u.Ai.Video(project.videoModel).run(...)
    const mockVideoPath = `project_${segment.projectId}/generated-videos/segment_${segmentId}_mock.mp4`;

    await db("o_segment").where("id", segmentId).update({
      videoGenState: "completed",
      videoGenPath: mockVideoPath,
      updateTime: Date.now(),
    });

    await db("o_tasks").where("id", taskId).update({ state: "已完成" });

    io.to(`project:${segment.projectId}`).emit("generation:segment:videoCompleted", {
      projectId: segment.projectId,
      segmentId,
      previewUrl: `/oss/${mockVideoPath}`,
    });

    res.json({ success: true, data: { videoPath: mockVideoPath } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
