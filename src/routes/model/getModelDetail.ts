import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getModelDetail(req: Request, res: Response) {
  try {
    const modelId = req.query.modelId as string; // "vendorId:modelName"
    if (!modelId) {
      return res.status(400).json({ success: false, message: "缺少模型ID" });
    }
    const [vendorId, modelName] = modelId.split(":");
    const vendor = await db("o_vendorConfig").where("id", vendorId).first();
    if (!vendor) {
      return res.status(404).json({ success: false, message: "供应商不存在" });
    }
    const models = JSON.parse(vendor.models || "[]");
    const model = models.find((m: any) => m.name === modelName);
    res.json({
      success: true,
      data: {
        vendorId: vendor.id,
        modelName,
        config: model,
        inputValues: vendor.inputValues,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
