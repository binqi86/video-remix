import type { Step, StepContext } from "./types";

export class VideoProcessor {
  private steps: Step[] = [];
  private segmentsOutputDir = "";

  constructor(steps: Step[]) {
    this.steps = steps;
  }

  getSteps() {
    return this.steps.map((s) => s.name);
  }

  async processSegment(ctx: StepContext): Promise<string> {
    let currentInput = ctx.inputPath;
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ext = currentInput.match(/\.[^.]+$/)?.[0] || ".mp4";
      const base = currentInput.replace(ext, "");
      const stepOutput = `${base}.${step.name}${ext}`;

      await ctx.onProgress(
        `第 ${i + 1}/${this.steps.length} 步：${step.name}...`,
        Math.round(((i) / this.steps.length) * 100),
      );

      await step.run({
        ...ctx,
        inputPath: currentInput,
        outputPath: stepOutput,
        onProgress: async (msg) => {
          await ctx.onProgress(msg);
        },
      });

      currentInput = stepOutput;
    }
    return currentInput;
  }
}
