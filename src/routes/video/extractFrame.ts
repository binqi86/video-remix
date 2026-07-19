import { Request, Response } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

export default async function extractFrame(req: Request, res: Response) {
  try {
    const { projectId, segmentId, source, frameType } = req.body;
    if (!projectId || !segmentId) {
      return res.status(400).json({ success: false, message: "缺少参数" });
    }

    const seg = await db("o_segment").where("id", segmentId).first();
    if (!seg) {
      return res.status(404).json({ success: false, message: "片段不存在" });
    }

    let videoPath: string;
    const clipPath = `project_${projectId}/segments/segment_${seg.sortOrder}.mp4`;
    if (source === "generated" && seg.videoGenPath) {
      videoPath = oss.resolve(seg.videoGenPath);
    } else {
      videoPath = oss.resolve(clipPath);
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, message: "视频文件不存在" });
    }

    const frameName = `frame_${source || "segment"}_${frameType}_${segmentId}.png`;
    const frameDir = oss.resolve(`project_${projectId}/frames`);
    fs.mkdirSync(frameDir, { recursive: true });
    const framePath = path.join(frameDir, frameName);

    const ss = frameType === "last" ? "-sseof -1" : "-ss 0";
    execSync(`ffmpeg -y ${ss} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`, { timeout: 30000 });

    const relativePath = `project_${projectId}/frames/${frameName}`;
    const url = `${req.protocol}://${req.get("host")}/oss/${relativePath}`;

    res.json({ success: true, data: { url, path: relativePath } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
