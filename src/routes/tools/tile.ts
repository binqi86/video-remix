import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { getDataPath } from "../../utils/getPath";

const upload = multer({ dest: path.resolve(process.cwd(), "data", "oss", "_temp") });

export default function tileImages(req: Request, res: Response) {
  upload.array("images", 50)(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length < 2) return res.status(400).json({ success: false, message: "请至少上传 2 张图片" });

      const cols = parseInt(req.body.cols) || 4;
      const gap = 10;
      const pad = 10;

      // Load image metadata
      const images = await Promise.all(files.map(f => sharp(f.path).metadata()));
      const cellW = Math.max(...images.map(m => m.width || 1));
      const cellH = Math.max(...images.map(m => m.height || 1));

      const totalW = cols * cellW + (cols - 1) * gap + pad * 2;
      const totalH = Math.ceil(files.length / cols) * cellH + (Math.ceil(files.length / cols) - 1) * gap + pad * 2;

      // Composite
      const layers: sharp.OverlayOptions[] = [];
      for (let i = 0; i < files.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * (cellW + gap);
        const y = pad + row * (cellH + gap);
        const buf = await sharp(files[i].path)
          .resize(cellW, cellH, { fit: "cover", position: "centre" })
          .toBuffer();
        layers.push({ input: buf, left: x, top: y });
        fs.unlinkSync(files[i].path); // clean temp
      }

      const outputName = `tile_${Date.now()}.jpg`;
      const outputDir = getDataPath("oss", "tools");
      fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, outputName);

      await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite(layers)
        .jpeg({ quality: 95 })
        .toFile(outputPath);

      const url = `${req.protocol}://${req.get("host")}/oss/tools/${outputName}`;
      res.json({ success: true, data: { url, width: totalW, height: totalH, images: files.length } });
    } catch (err: any) {
      console.error("[Tile] error:", err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });
}
