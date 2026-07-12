import { Request, Response } from "express";
import { db } from "../../utils/db";

export default async function startGeneration(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project) {
      return res.status(404).json({ success: false, message: "项目不存在" });
    }
    if (!project.imageModel || !project.videoModel) {
      return res.status(400).json({ success: false, message: "请先设置图像生成模型和视频生成模型" });
    }

    const segments = await db("o_segment")
      .where("projectId", projectId)
      .orderBy("sortOrder", "asc");

    // Validate all segments have required config
    const incompleteSegments = segments.filter(
      (s: any) => !s.prompt || !s.characterViewPath
    );
    if (incompleteSegments.length > 0) {
      return res.status(400).json({
        success: false,
        message: `有 ${incompleteSegments.length} 个分段未完成配置（缺少提示词或角色图）`,
      });
    }

    // Reset generation state
    for (const seg of segments) {
      await db("o_segment").where("id", (seg as any).id).update({
        imageGenState: "queued",
        videoGenState: "queued",
        imageGenPath: null,
        videoGenPath: null,
      });
    }

    // Update project status
    await db("o_project").where("id", projectId).update({
      status: "generating",
      updateTime: Date.now(),
    });

    // Start pipeline asynchronously
    const io = req.app.get("io");
    // Emit generation started event
    io.to(`project:${projectId}`).emit("generation:started", {
      projectId,
      totalSegments: segments.length,
      timestamp: Date.now(),
    });

    // Process segments sequentially in background
    process.nextTick(async () => {
      const pipeline = await import("../../pipeline/orchestrator");
      const orchestrator = pipeline.createOrchestrator(req.app);
      try {
        await orchestrator.runFullPipeline(projectId);
      } catch (err: any) {
        console.error("[Pipeline] Error:", err.message);
        io.to(`project:${projectId}`).emit("generation:failed", {
          projectId,
          error: err.message,
        });
        await db("o_project").where("id", projectId).update({
          status: "failed",
          updateTime: Date.now(),
        });
      }
    });

    res.json({
      success: true,
      data: {
        projectId,
        totalSegments: segments.length,
        message: "生成管线已启动",
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
