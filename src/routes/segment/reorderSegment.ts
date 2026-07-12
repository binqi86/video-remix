import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function reorderSegment(req: Request, res: Response) {
  try {
    const { id, sortOrder } = req.body;
    if (id === undefined || sortOrder === undefined) {
      return res.status(400).json({ success: false, message: "缺少必要参数" });
    }
    await db("o_segment").where("id", id).update({ sortOrder, updateTime: Date.now() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
