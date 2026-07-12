import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function cancelGeneration(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    // Mark running tasks as cancelled
    await db("o_tasks").where("projectId", projectId).where("state", "进行中").update({ state: "已取消" });
    await db("o_segment").where("projectId", projectId).update({
      imageGenState: "pending",
      videoGenState: "pending",
    });
    await db("o_project").where("id", projectId).update({ status: "ready", updateTime: Date.now() });

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("generation:cancelled", { projectId });

    res.json({ success: true, message: "生成已取消" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
