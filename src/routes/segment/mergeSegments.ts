import { Request, Response } from "express";
import { db } from "../../utils/db";
import { oss } from "../../utils/oss";
import { MAX_SEGMENT_DURATION } from "../video/segmenting";
import type { SegmentBoundary } from "../video/segmenting";
import { buildSegmentClips, carryMeta } from "../video/segmentBuilder";
import type { SegmentRowMeta } from "../video/segmentBuilder";

function parseSplitPoints(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(Number) : [];
  } catch {
    return [];
  }
}

function cleanSplitPoints(points: number[], minStart: number, maxEnd: number): number[] {
  return Array.from(new Set(points.map((t) => Math.round(t * 100) / 100)))
    .filter((t) => Number.isFinite(t) && t > minStart && t < maxEnd)
    .sort((a, b) => a - b);
}

export default async function mergeSegments(req: Request, res: Response) {
  try {
    const projectId = parseInt(req.body.projectId);
    const ids = (req.body.ids || []).map(Number);

    if (!projectId) {
      return res.status(400).json({ success: false, message: "缺少项目ID" });
    }
    if (ids.length < 2) {
      return res.status(400).json({ success: false, message: "请选择至少两个相邻片段" });
    }

    const project = await db("o_project").where("id", projectId).first();
    if (!project || !project.videoFilePath) {
      return res.status(400).json({ success: false, message: "项目不存在或未上传视频" });
    }

    const allSegs = await db("o_segment").where("projectId", projectId).orderBy("sortOrder", "asc").all();

    // Block merging while generation is running
    if (project.status === "generating" || allSegs.some((s: any) => s.imageGenState === "generating" || s.videoGenState === "generating")) {
      return res.status(409).json({ success: false, message: "视频生成进行中，请先取消或等待完成" });
    }

    // Validate ids form a contiguous run by sortOrder
    const idSet = new Set(ids);
    const runIdx = allSegs.map((s: any, i: number) => (idSet.has(s.id) ? i : -1)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (runIdx.length !== ids.length) {
      return res.status(400).json({ success: false, message: "部分片段不存在" });
    }
    for (let i = 1; i < runIdx.length; i++) {
      if (runIdx[i] !== runIdx[i - 1] + 1) {
        return res.status(400).json({ success: false, message: "只能合并相邻片段" });
      }
    }
    const k = runIdx[0];
    const l = runIdx[runIdx.length - 1];

    const minStart = allSegs[k].startTime;
    const maxEnd = allSegs[l].endTime;
    const total = maxEnd - minStart;
    if (total <= 0) {
      return res.status(400).json({ success: false, message: "片段范围无效" });
    }
    if (total > MAX_SEGMENT_DURATION) {
      return res.status(400).json({ success: false, message: `合并后时长 ${total.toFixed(1)}s 超过 ${MAX_SEGMENT_DURATION}s 限制` });
    }

    // Combined split points: each segment's own splitPoints plus the internal
    // boundary between consecutive merged segments.
    const internal: number[] = [];
    for (let idx = k; idx <= l; idx++) {
      const s = allSegs[idx];
      internal.push(...parseSplitPoints(s.splitPoints));
      if (idx < l) internal.push(s.endTime);
    }
    const splitPoints = cleanSplitPoints(internal, minStart, maxEnd);

    // Build boundaries + meta arrays; merged row is fully reset with splitPoints.
    const boundaries: SegmentBoundary[] = [
      ...allSegs.slice(0, k).map((s: any) => ({ start: s.startTime, end: s.endTime })),
      { start: minStart, end: maxEnd },
      ...allSegs.slice(l + 1).map((s: any) => ({ start: s.startTime, end: s.endTime })),
    ];
    const meta: (SegmentRowMeta | null)[] = [
      ...allSegs.slice(0, k).map((s: any) => carryMeta(s)),
      { splitPoints },
      ...allSegs.slice(l + 1).map((s: any) => carryMeta(s)),
    ];

    const built = await buildSegmentClips({
      projectId,
      videoPath: oss.resolve(project.videoFilePath),
      boundaries,
      meta,
      req,
    });

    res.json({ success: true, data: { totalSegments: built.length, segments: built, splitPoints } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}
