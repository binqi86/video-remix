import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function getModelList(req: Request, res: Response) {
  try {
    const type = (req.query.type as string) || "all"; // text | image | video | all
    const vendors = await db("o_vendorConfig").where("enable", 1).all();
    const models: Array<{ id: string; label: string; value: string; type: string; vendor: string }> = [];

    for (const vendor of vendors) {
      const parsedModels = JSON.parse(vendor.models || "[]");
      for (const m of parsedModels) {
        if (type === "all" || m.type === type) {
          models.push({
            id: `${vendor.id}:${m.name}`,
            label: `${vendor.id} - ${m.name}`,
            value: `${vendor.id}:${m.name}`,
            type: m.type,
            vendor: vendor.id,
          });
        }
      }
    }

    res.json({ success: true, data: models });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
