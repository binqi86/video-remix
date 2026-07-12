import { Router } from "express";
import prepareImport from "./prepareImport";
import getImport from "./getImport";
import { db, exec } from "../../utils/db";

const router = Router();
router.post("/prepare", prepareImport);
router.get("/get", getImport);

// Save project ↔ canvas mapping
router.post("/bind", async (req, res) => {
  try {
    const { projectId, canvasId, canvasTitle } = req.body;
    if (!projectId || !canvasId) return res.status(400).json({ success: false, message: "缺少参数" });
    // Store as JSON array of {canvasId, canvasTitle, timestamp}
    const key = `project_canvas_${projectId}`;
    const existing = await db("o_setting").where("key", key).first();
    let list: any[] = [];
    if (existing?.value) try { list = JSON.parse(existing.value); } catch {}
    list = list.filter((c: any) => c.canvasId !== canvasId);
    list.unshift({ canvasId, canvasTitle: canvasTitle || "", createdAt: Date.now() });
    exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", [key, JSON.stringify(list)]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

// Get project ↔ canvas mapping
router.get("/bindings", async (req, res) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) return res.status(400).json({ success: false, message: "缺少 projectId" });
    const row = await db("o_setting").where("key", `project_canvas_${projectId}`).first();
    res.json({ success: true, data: row?.value ? JSON.parse(row.value) : [] });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

// Delete a project-canvas binding
router.delete("/bind", async (req, res) => {
  try {
    const { projectId, canvasId } = req.body;
    if (!projectId || !canvasId) return res.status(400).json({ success: false, message: "缺少参数" });
    const key = `project_canvas_${projectId}`;
    const row = await db("o_setting").where("key", key).first();
    if (row?.value) {
      let list: any[] = JSON.parse(row.value);
      list = list.filter((c: any) => c.canvasId !== canvasId);
      exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", [key, JSON.stringify(list)]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
