import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getDataPath } from "../../utils/getPath";
import type { Step, StepContext } from "../types";

// tfjs-node uses deprecated util.isNullOrUndefined removed in Node 22
import util from "util";
if (typeof (util as any).isNullOrUndefined !== "function") {
  (util as any).isNullOrUndefined = (v: any) => v === null || v === undefined;
}

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Detect human faces in the video and apply mosaic blur to all face regions.
 *
 * Approach:
 *   1. Extract one frame per second from the video
 *   2. Run face-api detection on each frame
 *   3. Merge overlapping detections across frames
 *   4. Build FFmpeg filter chain with boxblur overlays
 */
export class FaceBlurStep implements Step {
  readonly name = "faceblur";

  async run(ctx: StepContext): Promise<void> {
    // Skip if face-api not initialized (tfjs-node may not be available)
    let detectFaces: (framePath: string) => Promise<FaceBox[]>;
    try {
      detectFaces = await this.initFaceDetection();
    } catch (e: any) {
      console.warn(`[FaceBlur] face-api 初始化失败: ${e.message}，跳过人脸马赛克`);
      fs.copyFileSync(ctx.inputPath, ctx.outputPath);
      return;
    }

    await ctx.onProgress("人脸检测中...");

    const tmpDir = path.join(getDataPath("oss"), "_tmp", `faceblur_${ctx.segmentId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Get video duration
      const probeCmd = `ffprobe -v quiet -print_format json -show_format "${ctx.inputPath}"`;
      const probeOut = JSON.parse(execSync(probeCmd).toString());
      const duration = parseFloat(probeOut.format?.duration || "0");
      const sampleCount = Math.max(1, Math.ceil(duration)); // 1 fps

      // Extract frames at 1fps
      await ctx.onProgress(`提取 ${sampleCount} 帧做检测...`);
      const framePattern = path.join(tmpDir, "frame_%04d.png");
      execSync(
        `ffmpeg -y -i "${ctx.inputPath}" -vf "fps=1" -q:v 2 "${framePattern}"`,
        { timeout: 120000 },
      );

      // Detect faces on each frame
      await ctx.onProgress("检测人脸区域...");
      const allBoxes: FaceBox[] = [];
      for (let i = 0; i < sampleCount; i++) {
        const framePath = path.join(tmpDir, `frame_${String(i + 1).padStart(4, "0")}.png`);
        if (!fs.existsSync(framePath)) continue;
        try {
          const faces = await detectFaces(framePath);
          allBoxes.push(...faces);
        } catch {
          // skip
        }
      }

      if (allBoxes.length === 0) {
        console.log("[FaceBlur] 未检测到人脸，跳过");
        fs.copyFileSync(ctx.inputPath, ctx.outputPath);
        return;
      }

      // Merge overlapping face boxes
      await ctx.onProgress(`检测到 ${allBoxes.length} 个人脸区域，合并中...`);
      const merged = this.mergeBoxes(allBoxes);
      console.log(`[FaceBlur] ${allBoxes.length} 检测框 → ${merged.length} 合并区域`);

      // Build FFmpeg filter chain
      await ctx.onProgress(`生成马赛克滤镜 (${merged.length} 个区域)...`);
      const filterScript = this.buildBlurFilter(merged);
      const filterFile = path.join(tmpDir, "filter.txt");
      fs.writeFileSync(filterFile, filterScript);

      execSync(
        `ffmpeg -y -i "${ctx.inputPath}" -filter_complex_script "${filterFile}" -map "[out]" -map 0:a -c:v libx264 -preset fast -crf 23 -c:a aac "${ctx.outputPath}"`,
        { timeout: 300000 },
      );

      await ctx.onProgress(`人脸马赛克完成: ${merged.length} 个区域`, 100);
    } finally {
      // Cleanup temp frames
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  private async initFaceDetection(): Promise<(framePath: string) => Promise<FaceBox[]>> {
    // tfjs-node must be loaded before face-api
    const tf = await import("@tensorflow/tfjs-node");
    await tf.ready();
    const faceapi = await import("@vladmandic/face-api");
    const { Canvas, Image, loadImage } = await import("canvas");

    // Monkey-patch for Node.js
    faceapi.env.monkeyPatch({ Canvas, Image } as any);

    // Load models from package
    const modelPath = path.join(
      path.dirname(require.resolve("@vladmandic/face-api/package.json")),
      "model",
    );
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);

    return async (framePath: string): Promise<FaceBox[]> => {
      const img = await loadImage(framePath);
      const detections = await faceapi.detectAllFaces(img as any, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }));
      return detections.map((d: any) => ({
        x: Math.round(d.box.x),
        y: Math.round(d.box.y),
        w: Math.round(d.box.width),
        h: Math.round(d.box.height),
      }));
    };
  }

  /** Merge overlapping face boxes into a small set of regions */
  private mergeBoxes(boxes: FaceBox[]): FaceBox[] {
    if (boxes.length <= 1) return boxes;
    let merged = [...boxes];
    let changed = true;
    while (changed) {
      changed = false;
      const newMerged: FaceBox[] = [];
      for (const box of merged) {
        let mergedInto = false;
        for (let i = 0; i < newMerged.length; i++) {
          const existing = newMerged[i];
          const overlap = this.intersectionArea(box, existing);
          const minArea = Math.min(box.w * box.h, existing.w * existing.h);
          if (minArea > 0 && overlap / minArea > 0.3) {
            newMerged[i] = {
              x: Math.min(existing.x, box.x),
              y: Math.min(existing.y, box.y),
              w: Math.max(existing.x + existing.w, box.x + box.w) - Math.min(existing.x, box.x),
              h: Math.max(existing.y + existing.h, box.y + box.h) - Math.min(existing.y, box.y),
            };
            mergedInto = true;
            changed = true;
            break;
          }
        }
        if (!mergedInto) newMerged.push(box);
      }
      merged = newMerged;
    }
    return merged;
  }

  private intersectionArea(a: FaceBox, b: FaceBox): number {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x);
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y);
    return w * h;
  }

  /** Generate FFmpeg filter_complex: split → crop+gblur → overlay chain */
  private buildBlurFilter(boxes: FaceBox[]): string {
    const lines: string[] = [];
    let current = "[0:v]";
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const padX = Math.round(b.w * 0.05);
      const padY = Math.round(b.h * 0.05);
      const cx = Math.max(0, Math.ceil((b.x - padX) / 2) * 2);
      const cy = Math.max(0, Math.ceil((b.y - padY) / 2) * 2);
      const cw = Math.ceil((b.w + padX * 2) / 2) * 2;
      const ch = Math.ceil((b.h + padY * 2) / 2) * 2;
      const blurLabel = `[b${i}]`;
      const outLabel = i < boxes.length - 1 ? `[v${i}]` : "[out]";
      lines.push(
        `${current}split${outLabel}${blurLabel};` +
        `${blurLabel}crop=${cw}:${ch}:${cx}:${cy},gblur=sigma=30:steps=4${blurLabel};` +
        `${outLabel}${blurLabel}overlay=${cx}:${cy}${outLabel}`,
      );
      current = outLabel;
    }
    return lines.join(";");
  }
}
