import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import type { SegmentBoundary } from "../video/segmenting";
import { buildSegmentClips, carryMeta } from "../video/segmentBuilder";
import type { SegmentRowMeta } from "../video/segmentBuilder";

export default async function splitSegment(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const id = parseInt(req.body.id);

    if (!projectId || !id) {
      return res.status(400).json({ success: false, message: "缺少项目ID或片段ID" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project || !project.videoFilePath) {
      return res.status(400).json({ success: false, message: "项目不存在或未上传视频" });
    }

    const seg = await db("o_segment").where("id", id).first();
    if (!seg) {
      return res.status(404).json({ success: false, message: "片段不存在" });
    }
    if (seg.projectId !== projectId) {
      return res.status(400).json({ success: false, message: "片段不属于该项目" });
    }

    const allSegs = await db("o_segment").where("projectId", projectId).orderBy("sortOrder", "asc").all();

    // Block splitting while generation is running
    if (project.status === "generating" || allSegs.some((s: any) => s.imageGenState === "generating" || s.videoGenState === "generating")) {
      return res.status(409).json({ success: false, message: "视频生成进行中，请先取消或等待完成" });
    }

    // Parse + sanitize split points
    let pts: number[] = [];
    if (seg.splitPoints) {
      try {
        const a = JSON.parse(seg.splitPoints);
        if (Array.isArray(a)) pts = a.map(Number);
      } catch {}
    }
    pts = Array.from(new Set(pts.map((t) => Math.round(t * 100) / 100)))
      .filter((t) => Number.isFinite(t) && t > seg.startTime && t < seg.endTime)
      .sort((a, b) => a - b);
    if (pts.length < 1) {
      return res.status(400).json({ success: false, message: "该片段不可拆分" });
    }

    const k = allSegs.findIndex((s: any) => s.id === id);
    if (k < 0) {
      return res.status(400).json({ success: false, message: "片段不存在" });
    }

    // Build sub-boundaries from split points
    const sub: SegmentBoundary[] = [];
    let prev = seg.startTime;
    for (const p of pts) {
      sub.push({ start: prev, end: p });
      prev = p;
    }
    sub.push({ start: prev, end: seg.endTime });

    const boundaries: SegmentBoundary[] = [
      ...allSegs.slice(0, k).map((s: any) => ({ start: s.startTime, end: s.endTime })),
      ...sub,
      ...allSegs.slice(k + 1).map((s: any) => ({ start: s.startTime, end: s.endTime })),
    ];

    // Sub-segments inherit the merged segment's character/background references
    // (same person/scene); prompt resets, splitPoints cleared.
    const subMeta: SegmentRowMeta = {
      characterViewPath: seg.characterViewPath,
      referenceFramePath: seg.referenceFramePath,
    };
    const meta: (SegmentRowMeta | null)[] = [
      ...allSegs.slice(0, k).map((s: any) => carryMeta(s)),
      ...sub.map(() => subMeta),
      ...allSegs.slice(k + 1).map((s: any) => carryMeta(s)),
    ];

    const built = await buildSegmentClips({
      projectId,
      videoPath: oss.resolve(project.videoFilePath),
      boundaries,
      meta,
      req,
    });

    res.json({ success: true, data: { totalSegments: built.length, segments: built } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
