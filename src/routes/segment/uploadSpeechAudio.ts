import { Request, Response } from "express";
import multer from "multer";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import {
  MAX_SPEECH_AUDIOS,
  MIN_SPEECH_DURATION_MS,
  MAX_SPEECH_DURATION_MS,
  MAX_SPEECH_TOTAL_MS,
  parseSpeechAudios,
  isProjectGenerating,
} from "./speechAudioUtils";

const upload = multer({
  dest: path.resolve(process.cwd(), "data", "oss", "_temp"),
  limits: { fileSize: 1024 * 1024 * 50 },
});

function probeDurationMs(filePath: string): number {
  const cmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`;
  try {
    const out = execSync(cmd, { timeout: 15000 }).toString().trim();
    return Math.round((parseFloat(out) || 0) * 1000);
  } catch {
    return 0;
  }
}

export default function uploadSpeechAudio(req: Request, res: Response) {
  upload.single("audio")(req, res, async (err: any) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    try {
      const projectId = parseInt(req.body.projectId);
      const segmentId = parseInt(req.body.segmentId);
      if (!projectId || !segmentId) {
        return res.status(400).json({ success: false, message: "缺少项目ID或片段ID" });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "请上传音频文件" });
      }

      const seg = await db("o_segment").where("id", segmentId).first();
      if (!seg) {
        return res.status(404).json({ success: false, message: "片段不存在" });
      }
      if (seg.projectId !== projectId) {
        return res.status(400).json({ success: false, message: "片段不属于该项目" });
      }
      if (await isProjectGenerating(projectId)) {
        return res.status(409).json({ success: false, message: "视频生成进行中，请先取消或等待完成" });
      }

      const existing = parseSpeechAudios(seg.speechAudios);
      if (existing.length >= MAX_SPEECH_AUDIOS) {
        return res.status(400).json({ success: false, message: `最多${MAX_SPEECH_AUDIOS}段对话音频` });
      }

      const durationMs = probeDurationMs(file.path);
      if (durationMs < MIN_SPEECH_DURATION_MS || durationMs > MAX_SPEECH_DURATION_MS) {
        return res.status(400).json({
          success: false,
          message: `音频时长需在 ${MIN_SPEECH_DURATION_MS / 1000}-${MAX_SPEECH_DURATION_MS / 1000} 秒之间（当前 ${(durationMs / 1000).toFixed(1)}s）`,
        });
      }
      const total = existing.reduce((s, a) => s + a.durationMs, 0) + durationMs;
      if (total > MAX_SPEECH_TOTAL_MS) {
        return res.status(400).json({
          success: false,
          message: `对话音频总时长不能超过 ${MAX_SPEECH_TOTAL_MS / 1000} 秒（当前添加后 ${(total / 1000).toFixed(1)}s）`,
        });
      }

      const ext = path.extname(file.originalname) || ".mp3";
      const fileName = `speech_${segmentId}_${Date.now()}${ext}`;
      const relativePath = `project_${projectId}/speech/${fileName}`;
      const fullPath = oss.resolve(relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.copyFileSync(file.path, fullPath);
      fs.unlinkSync(file.path);

      const entry = { fileName: file.originalname, path: relativePath, durationMs };
      const next = [...existing, entry];
      await db("o_segment").where("id", segmentId).update({
        speechAudios: JSON.stringify(next),
        updateTime: Date.now(),
      });

      res.json({ success: true, data: next });
    } catch (e: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}
