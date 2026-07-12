import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function generateImage(req: Request, res: Response) {
  try {
    const { segmentId } = req.body;
    if (!segmentId) {
      return res.status(400).json({ success: false, message: "缺少分段ID" });
    }

    const segment = await db("o_segment").where("id", segmentId).first();
    if (!segment) {
      return res.status(404).json({ success: false, message: "分段不存在" });
    }

    if (!segment.characterViewPath) {
      return res.status(400).json({ success: false, message: "请先上传角色图" });
    }

    // Update state
    await db("o_segment").where("id", segmentId).update({
      imageGenState: "generating",
      updateTime: Date.now(),
    });

    // Create task
    const taskId = Date.now();
    await db("o_tasks").insert({
      id: taskId,
      projectId: segment.projectId,
      segmentId,
      taskClass: "imageGen",
      state: "进行中",
      startTime: Date.now(),
    });

    // TODO: Actual AI image generation would go here.
    // For now, emit event and mark as completed as mock.
    const io = req.app.get("io");
    io.to(`project:${segment.projectId}`).emit("generation:segment:imageStarted", {
      projectId: segment.projectId,
      segmentId,
    });

    // Mock: In production, call u.Ai.Image(project.imageModel).run(...)
    const mockImagePath = `project_${segment.projectId}/generated-images/segment_${segmentId}_mock.png`;

    await db("o_segment").where("id", segmentId).update({
      imageGenState: "completed",
      imageGenPath: mockImagePath,
      updateTime: Date.now(),
    });

    await db("o_tasks").where("id", taskId).update({ state: "已完成" });

    io.to(`project:${segment.projectId}`).emit("generation:segment:imageCompleted", {
      projectId: segment.projectId,
      segmentId,
      previewUrl: `/oss/${mockImagePath}`,
    });

    res.json({ success: true, data: { imagePath: mockImagePath } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
