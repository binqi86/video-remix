import { Router } from "express";
import { getTunnelConfig, saveTunnelConfig, checkCloudflared } from "../../utils/tunnel";

const router = Router();

// Get current tunnel config
router.get("/config", (_req, res) => {
  const config = getTunnelConfig();
  const hasCloudflared = checkCloudflared();
  res.json({
    success: true,
    data: { ...config, hasCloudflared, availableProviders: ["none", "cloudflared"] },
  });
});

// Update tunnel config
router.put("/config", (req, res) => {
  try {
    const { provider, port } = req.body;
    if (!provider || !["none", "cloudflared"].includes(provider)) {
      return res.status(400).json({ success: false, message: "无效的 provider" });
    }
    saveTunnelConfig({ provider, port: port || 3001 });
    res.json({ success: true, message: "隧道配置已保存，重启后生效" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

// Get current tunnel public URL
router.get("/url", (_req, res) => {
  const url = process.env.TUNNEL_URL || null;
  res.json({ success: true, data: { url, active: !!url } });
});
