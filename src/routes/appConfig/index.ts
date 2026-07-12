import { Router } from "express";
import { readConfig, writeConfig } from "../../utils/config";

const router = Router();

router.get("/config", (_req, res) => {
  const config = readConfig();
  res.json({ success: true, data: config });
});

router.put("/config", (req, res) => {
  try {
    const { appPort, canvasPort } = req.body;
    writeConfig({ appPort, canvasPort });
    res.json({ success: true, message: "配置已保存" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
