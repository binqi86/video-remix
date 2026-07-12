import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getTaskStatus(req: Request, res: Response) {
  try {
    const id = parseInt(req.query.id as string);
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少任务ID" });
    }
    const task = await db("o_tasks").where("id", id).first();
    res.json({ success: true, data: task });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
