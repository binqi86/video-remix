export interface StepContext {
  segmentId: number;
  projectId: number;
  inputPath: string;
  outputPath: string;
  onProgress: (message: string, percent?: number) => Promise<void>;
}

export interface Step {
  readonly name: string;
  run(ctx: StepContext): Promise<void>;
}
