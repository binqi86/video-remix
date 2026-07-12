import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function deleteAsset(req: Request, res: Response) {
  try {
    const id = parseInt(req.query.id as string);
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少资产ID" });
    }
    const asset = await db("o_asset").where("id", id).first();
    if (asset) {
      oss.deleteFile(asset.filePath);
    }
    await db("o_asset").where("id", id).del();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
