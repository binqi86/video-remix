import { db } from "../utils/db";
import { oss } from "../utils/oss";

export class Orchestrator {
  private app: any;

  constructor(app: any) {
    this.app = app;
  }

  get io() {
    return this.app.get("io");
  }

  async runFullPipeline(projectId: number) {
    try {
      const project = await db("o_project").where("id", projectId).first();
      if (!project) throw new Error("项目不存在");

      const segments = await db("o_segment")
        .where("projectId", projectId)
        .orderBy("sortOrder", "asc");

      // Phase 3a: Image generation for each segment
      for (const segment of segments) {
        await this.generateImageForSegment(project, segment);
      }

      // Phase 3b: Video generation for each segment
      for (const segment of segments) {
        await this.generateVideoForSegment(project, segment);
      }

      // Phase 3c: Stitch all videos together
      await this.stitchSegments(project, segments);

      this.io.to(`project:${projectId}`).emit("generation:completed", { projectId });
    } catch (err: any) {
      await db("o_project").where("id", projectId).update({
        status: "failed",
        updateTime: Date.now(),
      });
      throw err;
    }
  }

  private async generateImageForSegment(project: any, segment: any) {
    const segmentId = segment.id;
    this.io.to(`project:${project.id}`).emit("generation:segment:imageStarted", {
      projectId: project.id, segmentId,
    });

    await db("o_segment").where("id", segmentId).update({
      imageGenState: "generating",
      updateTime: Date.now(),
    });

    const taskId = Date.now();
    await db("o_tasks").insert({
      id: taskId,
      projectId: project.id,
      segmentId,
      taskClass: "imageGen",
      model: project.imageModel,
      describe: `分段 ${segment.sortOrder + 1} 图像生成`,
      state: "进行中",
      startTime: Date.now(),
    });

    try {
      // TODO: Actual AI image generation pipeline
      // const aiImage = u.Ai.Image(project.imageModel);
      // const characterBase64 = oss.readFileAsBase64(segment.characterViewPath);
      // await aiImage.run({ prompt: segment.prompt, referenceList: [{ type: 'image', base64: characterBase64 }] });
      // const imagePath = `project_${project.id}/generated-images/segment_${segmentId}.png`;
      // await aiImage.save(oss.resolve(imagePath));

      // Mock: Copy a placeholder
      const imagePath = `project_${project.id}/generated-images/segment_${segmentId}.png`;
      oss.writeFile(imagePath, Buffer.from("mock_image_data"));

      await db("o_segment").where("id", segmentId).update({
        imageGenState: "completed",
        imageGenPath: imagePath,
        updateTime: Date.now(),
      });
      await db("o_tasks").where("id", taskId).update({ state: "已完成" });

      this.io.to(`project:${project.id}`).emit("generation:segment:imageCompleted", {
        projectId: project.id, segmentId,
        previewUrl: `/oss/${imagePath}`,
      });
    } catch (err: any) {
      await db("o_segment").where("id", segmentId).update({
        imageGenState: "failed",
        errorReason: err.message,
        updateTime: Date.now(),
      });
      await db("o_tasks").where("id", taskId).update({ state: "生成失败", reason: err.message });
      throw err;
    }
  }

  private async generateVideoForSegment(project: any, segment: any) {
    const segmentId = segment.id;
    this.io.to(`project:${project.id}`).emit("generation:segment:videoStarted", {
      projectId: project.id, segmentId,
    });

    await db("o_segment").where("id", segmentId).update({
      videoGenState: "generating",
      updateTime: Date.now(),
    });

    const taskId = Date.now() + 1;
    await db("o_tasks").insert({
      id: taskId,
      projectId: project.id,
      segmentId,
      taskClass: "videoGen",
      model: project.videoModel,
      describe: `分段 ${segment.sortOrder + 1} 视频生成`,
      state: "进行中",
      startTime: Date.now(),
    });

    try {
      // TODO: Actual AI video generation
      // const aiVideo = u.Ai.Video(project.videoModel);
      // const refImageBase64 = oss.readFileAsBase64(segment.imageGenPath);
      // await aiVideo.run({
      //   prompt: segment.prompt,
      //   duration: segment.duration,
      //   referenceList: [{ type: 'image', base64: refImageBase64 }],
      // });
      // const videoPath = `project_${project.id}/generated-videos/segment_${segmentId}.mp4`;
      // await aiVideo.save(oss.resolve(videoPath));

      const videoPath = `project_${project.id}/generated-videos/segment_${segmentId}.mp4`;
      oss.writeFile(videoPath, Buffer.from("mock_video_data"));

      await db("o_segment").where("id", segmentId).update({
        videoGenState: "completed",
        videoGenPath: videoPath,
        updateTime: Date.now(),
      });
      await db("o_tasks").where("id", taskId).update({ state: "已完成" });

      this.io.to(`project:${project.id}`).emit("generation:segment:videoCompleted", {
        projectId: project.id, segmentId,
        previewUrl: `/oss/${videoPath}`,
      });
    } catch (err: any) {
      await db("o_segment").where("id", segmentId).update({
        videoGenState: "failed",
        errorReason: err.message,
        updateTime: Date.now(),
      });
      await db("o_tasks").where("id", taskId).update({ state: "生成失败", reason: err.message });
      throw err;
    }
  }

  private async stitchSegments(project: any, segments: any[]) {
    this.io.to(`project:${project.id}`).emit("generation:stitch:started", {
      projectId: project.id,
    });

    const taskId = Date.now() + 2;
    await db("o_tasks").insert({
      id: taskId,
      projectId: project.id,
      taskClass: "stitch",
      describe: "最终视频拼接",
      state: "进行中",
      startTime: Date.now(),
    });

    try {
      // Build concat file list
      const outputDir = oss.resolve(`project_${project.id}/output`);
      const fileListContent = segments
        .map((s: any) => `file '${oss.resolve(s.videoGenPath || "")}'`)
        .join("\n");
      const outputName = `remixed_${Date.now()}.mp4`;
      const outputRelativePath = `project_${project.id}/output/${outputName}`;

      // Use FFmpeg concat in production
      // For now, mark as mock completed
      oss.writeFile(outputRelativePath, Buffer.from("mock_stitched_video"));

      await db("o_asset").insert({
        id: Date.now(),
        projectId: project.id,
        type: "stitched_output",
        fileName: outputName,
        filePath: outputRelativePath,
        mimeType: "video/mp4",
        createTime: Date.now(),
      });

      await db("o_project").where("id", project.id).update({
        status: "completed",
        updateTime: Date.now(),
      });
      await db("o_tasks").where("id", taskId).update({ state: "已完成" });

      this.io.to(`project:${project.id}`).emit("generation:stitch:completed", {
        projectId: project.id,
        outputUrl: `/oss/${outputRelativePath}`,
      });
    } catch (err: any) {
      await db("o_tasks").where("id", taskId).update({ state: "生成失败", reason: err.message });
      throw err;
    }
  }
}

export function createOrchestrator(app: any): Orchestrator {
  return new Orchestrator(app);
}
