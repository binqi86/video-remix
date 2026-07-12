import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";

function fixFilename(original: string): string {
  try {
    const fixed = Buffer.from(original, "latin1").toString("utf-8");
    if (fixed !== original && /[一-鿿]/.test(fixed)) return fixed;
  } catch {}
  return original;
}

const upload = multer({
  dest: path.resolve(process.cwd(), "data", "oss", "_temp"),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

export default async function uploadAsset(req: Request, res: Response) {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    try {
      const file = req.file;
      const { projectId, type, segmentId } = req.body;
      if (!file || !projectId || !type) {
        return res.status(400).json({ success: false, message: "缺少必要参数" });
      }

      const ext = path.extname(file.originalname) || "";
      const now = Date.now();
      const fileName = `${type}_${now}${ext}`;
      const relativePath = `project_${projectId}/${type}/${fileName}`;
      const fullPath = oss.resolve(relativePath);

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(file.path, fullPath);

      const assetId = now;
      await db("o_asset").insert({
        id: assetId,
        projectId,
        segmentId: segmentId ? parseInt(segmentId) : null,
        type,
        fileName: fixFilename(file.originalname),
        filePath: relativePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        createTime: now,
      });

      // If this is a character_view or reference_frame, update the segment
      if ((type === "character_view" || type === "reference_frame") && segmentId) {
        const updateKey = type === "character_view" ? "characterViewPath" : "referenceFramePath";
        await db("o_segment").where("id", parseInt(segmentId)).update({
          [updateKey]: relativePath,
          updateTime: now,
        });
      }

      res.json({
        success: true,
        data: { id: assetId, filePath: relativePath, url: `/oss/${relativePath}` },
      });
    } catch (err: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ success: false, message: err.message });
    }
  });
}
