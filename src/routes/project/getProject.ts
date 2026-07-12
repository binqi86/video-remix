import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getProject(req: Request, res: Response) {
  try {
    const id = parseInt(req.query.id as string);
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    const project = await db("o_project").where("id", id).first();
    if (!project) {
      return res.status(404).json({ success: false, message: "项目不存在" });
    }
    const segments = await db("o_segment").where("projectId", id).orderBy("sortOrder", "asc").all();
    res.json({ success: true, data: { ...project, segments } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
