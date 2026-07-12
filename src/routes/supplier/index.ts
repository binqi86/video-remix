import { Router } from "express";
import { getSuppliers, saveSuppliers } from "../../utils/supplier";

const router = Router();

// List suppliers
router.get("/list", async (_req, res) => {
  const suppliers = await getSuppliers();
  res.json({ success: true, data: suppliers });
});

// Save suppliers
router.post("/save", async (req, res) => {
  try {
    if (!Array.isArray(req.body.suppliers)) {
      return res.status(400).json({ success: false, message: "需要 suppliers 数组" });
    }
    await saveSuppliers(req.body.suppliers);
    res.json({ success: true, message: "已保存" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
