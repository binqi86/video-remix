import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getSetting(req: Request, res: Response) {
  try {
    const key = req.query.key as string;
    let settings: any[];
    if (key) {
      settings = await db("o_setting").where("key", key).all();
    } else {
      settings = await db("o_setting").select("*").all();
    }
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
