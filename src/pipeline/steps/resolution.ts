import { execSync } from "child_process";
import fs from "fs";
import type { Step, StepContext } from "../types";

/**
 * Ensure the video fits Seedance reference video pixel bounds:
 *   minimum 640×640 (409600 pixels)
 *   maximum 834×1112 (927408 pixels)
 *   single side at least 300px
 */
export class ResolutionStep implements Step {
  readonly name = "resolution";

  async run(ctx: StepContext): Promise<void> {
    await ctx.onProgress("像素检测中...");

    // Skip if input == output (same file, nothing to do)
    if (ctx.inputPath === ctx.outputPath) {
      fs.copyFileSync(ctx.inputPath, ctx.outputPath);
      return;
    }

    const probeCmd = `ffprobe -v quiet -print_format json -show_streams "${ctx.inputPath}"`;
    const probeOut = JSON.parse(execSync(probeCmd).toString());
    const vs = probeOut.streams.find((s: any) => s.codec_type === "video");
    if (!vs?.width || !vs?.height) {
      // Can't probe, copy as-is
      fs.copyFileSync(ctx.inputPath, ctx.outputPath);
      return;
    }

    const sw = vs.width;
    const sh = vs.height;
    const pixels = sw * sh;

    const MIN_PIX = 409600;
    const MAX_PIX = 927408;
    const TARGET_DIM = 480;

    let scale: number | null = null;

    if (pixels < MIN_PIX || Math.min(sw, sh) < TARGET_DIM) {
      const s = Math.sqrt(Math.max(MIN_PIX / pixels, (TARGET_DIM * TARGET_DIM) / (sw * sh)));
      scale = s;
      await ctx.onProgress(`分辨率不足 ${sw}x${sh}，升频中...`);
    } else if (pixels > MAX_PIX) {
      scale = Math.sqrt(MAX_PIX / pixels);
      await ctx.onProgress(`像素超出上限 ${sw}x${sh}，降频中...`);
    }

    if (scale === null) {
      // Within bounds, just copy
      fs.copyFileSync(ctx.inputPath, ctx.outputPath);
      await ctx.onProgress("像素检测通过", 100);
      return;
    }

    const tw = Math.ceil(sw * scale / 2) * 2;
    const th = Math.ceil(sh * scale / 2) * 2;

    const cmd = `ffmpeg -y -i "${ctx.inputPath}" -vf "scale=${tw}:${th}:flags=lanczos" -c:v libx264 -preset fast -crf 23 -c:a aac "${ctx.outputPath}"`;
    execSync(cmd, { timeout: 300000 });

    await ctx.onProgress(`分辨率已调整: ${tw}x${th}`, 100);
  }
}
