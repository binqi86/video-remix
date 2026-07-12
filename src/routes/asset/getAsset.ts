import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function getAsset(req: Request, res: Response) {
  try {
    const id = parseInt(req.query.id as string);
    if (!id) {
      const projectId = parseInt(req.query.projectId as string);
      if (projectId) {
        const type = req.query.type as string;
        const query = db("o_asset").where("projectId", projectId);
        if (type) query.where("type", type);
        const assets = await query.orderBy("createTime", "desc");
        return res.json({ success: true, data: assets });
      }
      return res.status(400).json({ success: false, message: "缺少参数" });
    }
    const asset = await db("o_asset").where("id", id).first();
    res.json({ success: true, data: asset });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
