import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getImport(req: Request, res: Response) {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ success: false, message: "缺少 token" });
    }
    const row = await db("o_setting").where("key", token).first();
    if (!row) {
      return res.status(404).json({ success: false, message: "导入数据不存在或已过期" });
    }
    // Delete after read (one-time)
    await db("o_setting").where("key", token).del();
    const data = JSON.parse(row.value);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
