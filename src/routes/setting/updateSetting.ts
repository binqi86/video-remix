import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function updateSetting(req: Request, res: Response) {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ success: false, message: "缺少设置键" });
    }
    const existing = await db("o_setting").where("key", key).first();
    if (existing) {
      await db("o_setting").where("key", key).update({ value });
    } else {
      await db("o_setting").insert({ key, value });
    }
    res.json({ success: true, data: { key, value } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
