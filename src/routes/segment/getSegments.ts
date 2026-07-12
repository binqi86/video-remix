import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getSegments(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.query.projectId as string);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    const segments = await db("o_segment")
      .where("projectId", projectId)
      .orderBy("sortOrder", "asc")
      .all();
    res.json({ success: true, data: segments });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
