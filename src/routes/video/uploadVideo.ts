import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

// Fix garbled UTF-8 filenames (multer bug with Chinese characters)
function fixFilename(original: string): string {
  // If it contains garbled chars (Latin-1 interpreted UTF-8), re-encode
  try {
    const fixed = Buffer.from(original, "latin1").toString("utf-8");
    // Check if fixed is different and looks valid
    if (fixed !== original && /[一-鿿]/.test(fixed)) {
      return fixed;
    }
  } catch {}
  return original;
}

// Configure multer for the upload
const upload = multer({
  dest: path.resolve(process.cwd(), "data", "oss", "_temp"),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB max
});

export default async function uploadVideo(req: Request, res: Response) {
  upload.single("video")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    try {
      const file = req.file;
      const projectId = parseInt(req.body.projectId);
      if (!file || !projectId) {
        return res.status(400).json({ success: false, message: "缺少文件或项目ID" });
      }

      // Move file to project OSS dir
      const ext = path.extname(file.originalname) || ".mp4";
      const cleanName = fixFilename(file.originalname);
      const fileName = `original_${Date.now()}${ext}`;
      const relativePath = `project_${projectId}/original/${fileName}`;
      const fullPath = oss.resolve(relativePath);

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.renameSync(file.path, fullPath);

      // Update project record
      await db("o_project").where("id", projectId).update({
        videoFileName: cleanName,
        videoFilePath: relativePath,
        status: "analyzing",
        updateTime: Date.now(),
      });

      // Create asset record
      await db("o_asset").insert({
        id: Date.now(),
        projectId,
        type: "reference_video",
        fileName: cleanName,
        filePath: relativePath,
        mimeType: file.mimetype || "video/mp4",
        fileSize: file.size,
        createTime: Date.now(),
      });

      res.json({
        success: true,
        data: {
          filePath: relativePath,
          fileName: cleanName,
          fileSize: file.size,
        },
      });
    } catch (err: any) {
      // Clean up temp file if exists
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ success: false, message: err.message });
    }
  });
}
