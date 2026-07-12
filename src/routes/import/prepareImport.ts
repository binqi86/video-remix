import { Request, Response } from "express";
import { db, exec } from "../../utils/db";

export function getImportData(token: string): any {
  // Not needed, using GET endpoint instead
  return null;
}

export default async function prepareImport(req: Request, res: Response) {
  try {
    const { nodes, connections } = req.body;
    if (!nodes || !Array.isArray(nodes)) {
      return res.status(400).json({ success: false, message: "缺少 nodes 数据" });
    }
    const token = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const value = JSON.stringify({ nodes, connections: connections || [] });
    // Use INSERT OR REPLACE (SQLite specific)
    exec(`INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)`, [token, value]);
    // Auto-clean after 5 min
    setTimeout(async () => {
      await db("o_setting").where("key", token).del();
    }, 300000);

    res.json({ success: true, data: { token } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
