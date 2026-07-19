import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, syncSave } from "../../utils/db";
import { oss } from "../../utils/oss";

const upload = multer({
  dest: path.resolve(process.cwd(), "data", "oss", "_temp"),
  limits: { fileSize: 1024 * 1024 * 500 },
});

export default function uploadGenerated(req: Request, res: Response) {
  upload.single("video")(req, res, function (err: any) {
    if (err) {
      console.error("[Upload] multer error:", err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    handleUpload(req, res);
  });
}

async function handleUpload(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const segmentId = parseInt(req.body.segmentId);
    if (!projectId || !segmentId) {
      return res.status(400).json({ success: false, message: `缺少参数 projectId=${req.body.projectId} segmentId=${req.body.segmentId}` });
    }

    const seg = await db("o_segment").where("id", segmentId).first();
    if (!seg) return res.status(404).json({ success: false, message: "片段不存在" });

    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "请上传视频文件" });

    const ext = path.extname(file.originalname) || ".mp4";
    const fileName = `generated_${segmentId}_${Date.now()}${ext}`;
    const fileDir = oss.resolve(`project_${projectId}/generated-videos`);
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, fileName);

    fs.copyFileSync(file.path, filePath);
    fs.unlinkSync(file.path);

    const relativePath = `project_${projectId}/generated-videos/${fileName}`;

    await db("o_segment").where("id", segmentId).update({
      videoGenPath: relativePath,
      videoGenState: "completed",
      updateTime: Date.now(),
    });
    syncSave();

    // Verify the update persisted
    const verify = await db("o_segment").where("id", segmentId).first();
    console.log(`[Upload] 保存验证: id=${segmentId} path=${verify?.videoGenPath} state=${verify?.videoGenState} 文件存在=${fs.existsSync(filePath)}`);

    console.log(`[Upload] 生成视频上传成功: ${relativePath}`);
    res.json({ success: true, data: { path: relativePath } });
  } catch (err: any) {
    console.error("[Upload] error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}
