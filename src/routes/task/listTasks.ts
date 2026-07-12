import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function listTasks(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.query.projectId as string);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    const tasks = await db("o_tasks")
      .where("projectId", projectId)
      .orderBy("startTime", "desc")
      .all();
    res.json({ success: true, data: tasks });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
