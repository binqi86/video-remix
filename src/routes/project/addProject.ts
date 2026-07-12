import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function addProject(req: Request, res: Response) {
  try {
    const { name, description = "" } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: "项目名称不能为空" });
    }
    const now = Date.now();
    const id = await db("o_project").insert({
      id: now,
      name,
      description,
      status: "draft",
      createTime: now,
      updateTime: now,
    });
    const project = await db("o_project").where("id", id).first();
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
