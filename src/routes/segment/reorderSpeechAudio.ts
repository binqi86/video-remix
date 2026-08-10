import { Request, Response } from "express";
import { db } from "../../utils/db";
import { parseSpeechAudios, isProjectGenerating } from "./speechAudioUtils";

export default async function reorderSpeechAudio(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const segmentId = parseInt(req.body.segmentId);
    const from = parseInt(req.body.from);
    const to = parseInt(req.body.to);
    if (!projectId || !segmentId || isNaN(from) || isNaN(to)) {
      return res.status(400).json({ success: false, message: "缺少必要参数" });
    }

    const seg = await db("o_segment").where("id", segmentId).first();
    if (!seg) return res.status(404).json({ success: false, message: "片段不存在" });
    if (seg.projectId !== projectId) {
      return res.status(400).json({ success: false, message: "片段不属于该项目" });
    }
    if (await isProjectGenerating(projectId)) {
      return res.status(409).json({ success: false, message: "视频生成进行中，请先取消或等待完成" });
    }

    const list = parseSpeechAudios(seg.speechAudios);
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) {
      return res.status(400).json({ success: false, message: "音频索引无效" });
    }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    await db("o_segment").where("id", segmentId).update({
      speechAudios: JSON.stringify(list),
      updateTime: Date.now(),
    });

    res.json({ success: true, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
