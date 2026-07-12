import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function delProject(req: Request, res: Response) {
  try {
    const id = parseInt(req.query.id as string);
    if (!id) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    // Cascade: delete segments, assets, tasks
    await db("o_segment").where("projectId", id).del();
    await db("o_asset").where("projectId", id).del();
    await db("o_tasks").where("projectId", id).del();
    await db("o_project").where("id", id).del();
    // Clean up OSS files
    oss.deleteDirectory(`project_${id}`);

    res.json({ success: true, message: "项目已删除" });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
