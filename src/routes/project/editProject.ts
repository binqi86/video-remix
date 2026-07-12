import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function editProject(req: Request, res: Response) {
  try {
    const { id, name, description, textModel, imageModel, videoModel, status } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    const updateData: any = { updateTime: Date.now() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (textModel !== undefined) updateData.textModel = textModel;
    if (imageModel !== undefined) updateData.imageModel = imageModel;
    if (videoModel !== undefined) updateData.videoModel = videoModel;
    if (status !== undefined) updateData.status = status;

    await db("o_project").where("id", id).update(updateData);
    const project = await db("o_project").where("id", id).first();
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
