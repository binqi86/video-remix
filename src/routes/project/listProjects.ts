import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function listProjects(req: Request, res: Response) {
  try {
    const projects = await db("o_project")
      .select("*")
      .orderBy("createTime", "desc")
      .all();
    res.json({ success: true, data: projects });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
