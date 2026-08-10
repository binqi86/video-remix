import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import { detectShots, mergeShortTrailingSegment, segmentByShot, segmentByCustom } from "./segmenting";
import type { SegmentBoundary } from "./segmenting";
import { buildSegmentClips } from "./segmentBuilder";

export default async function segmentVideo(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const mode = req.body.mode || "shot";
    const customRanges = req.body.customRanges || "";

    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project || !project.videoFilePath) {
      return res.status(400).json({ success: false, message: "项目不存在或未上传视频" });
    }

    const videoPath = oss.resolve(project.videoFilePath);
    const duration = project.videoDuration;
    if (!duration || duration <= 0) {
      return res.status(400).json({ success: false, message: "视频时长无效，请先分析视频" });
    }

    // Save segmentation mode to project
    await db("o_project").where("id", projectId).update({
      segmentationMode: mode,
      updateTime: Date.now(),
    });

    // Build segments based on the selected mode
    let boundaries: SegmentBoundary[];
    if (mode === "shot") {
      const shotTimes = detectShots(videoPath);
      console.log(`[Segment] 镜头检测到 ${shotTimes.length} 个切换点`);
      boundaries = mergeShortTrailingSegment(segmentByShot(shotTimes, duration));
    } else if (mode === "custom") {
      boundaries = segmentByCustom(customRanges, duration);
    } else {
      return res.status(400).json({ success: false, message: "不支持的分段模式" });
    }

    if (boundaries.length === 0) {
      return res.status(400).json({ success: false, message: "未生成任何片段" });
    }

    const built = await buildSegmentClips({
      projectId,
      videoPath,
      boundaries,
      meta: boundaries.map(() => null),
      req,
    });

    res.json({
      success: true,
      data: {
        mode,
        totalSegments: built.length,
        segments: built,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
