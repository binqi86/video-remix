import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function updateSegment(req: Request, res: Response) {
  try {
    const { id, prompt, characterViewPath, referenceFramePath, imageGenState, videoGenState } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少分段ID" });
    }
    const updateData: any = { updateTime: Date.now() };
    if (prompt !== undefined) updateData.prompt = prompt;
    if (characterViewPath !== undefined) updateData.characterViewPath = characterViewPath;
    if (referenceFramePath !== undefined) updateData.referenceFramePath = referenceFramePath;
    if (imageGenState !== undefined) updateData.imageGenState = imageGenState;
    if (videoGenState !== undefined) updateData.videoGenState = videoGenState;

    await db("o_segment").where("id", id).update(updateData);
    const segment = await db("o_segment").where("id", id).first();
    res.json({ success: true, data: segment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
