import { execSync } from "child_process";

export type SegmentBoundary = { start: number; end: number };

export const MAX_SEGMENT_DURATION = 15; // seconds (hard limit for all modes, AI video generation cap)
const SHOT_THRESHOLD = 10; // scdet t, 0-100 scale. lower = more sensitive
const SHOT_MIN_GAP = 0.5; // drop a boundary within this many seconds of the previous kept one

export function parseTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

/**
 * Merge the last segment into the previous one if it's shorter than minDuration.
 * This prevents creating a useless tiny trailing fragment.
 */
export function mergeShortTrailingSegment(segments: SegmentBoundary[], minDuration: number = 0.5): SegmentBoundary[] {
  if (segments.length < 2) return segments;
  const last = segments[segments.length - 1];
  const prev = segments[segments.length - 2];
  if (last.end - last.start < minDuration) {
    prev.end = last.end;
    return segments.slice(0, -1);
  }
  return segments;
}

/**
 * Detect shot boundaries using FFmpeg's scdet filter (FFmpeg 6+).
 * Parses `lavfi.scd.time` from stderr, which is emitted when a frame's scene
 * score exceeds the threshold. Boundaries closer than SHOT_MIN_GAP to the
 * previous kept one are dropped to suppress detection bursts.
 */
export function detectShots(videoPath: string, threshold: number = SHOT_THRESHOLD): number[] {
  const cmd = `ffmpeg -y -i "${videoPath}" -vf "scdet=t=${threshold}" -an -f null - 2>&1`;
  try {
    const output = execSync(cmd, { timeout: 300000 }).toString();
    const times: number[] = [];
    const re = /lavfi\.scd\.time:\s+([\d.]+)/g;
    let m;
    while ((m = re.exec(output)) !== null) {
      const t = parseFloat(m[1]);
      if (isNaN(t) || t <= 0) continue;
      if (times.length === 0 || t - times[times.length - 1] > SHOT_MIN_GAP) {
        times.push(t);
      }
    }
    return times;
  } catch {
    return [];
  }
}

/**
 * Mode 'shot': split purely at shot boundaries, with a max segment cap.
 * Scenes can be longer, but capped at MAX_SEGMENT_DURATION.
 */
export function segmentByShot(shotTimes: number[], duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  let currentStart = 0;

  for (const shotTime of shotTimes) {
    if (shotTime <= currentStart) continue;
    if (shotTime >= duration) break;

    // If the gap since last split exceeds MAX_SEGMENT_DURATION, force a split
    // even without a shot change (prevent extreme long segments)
    if (shotTime - currentStart > MAX_SEGMENT_DURATION) {
      let forcedEnd = currentStart + MAX_SEGMENT_DURATION;
      while (forcedEnd < shotTime) {
        segments.push({ start: currentStart, end: forcedEnd });
        currentStart = forcedEnd;
        forcedEnd = currentStart + MAX_SEGMENT_DURATION;
      }
    }
    segments.push({ start: currentStart, end: shotTime });
    currentStart = shotTime;
  }

  // Final segment
  if (currentStart < duration) {
    // If the final segment is too long, split it
    while (duration - currentStart > MAX_SEGMENT_DURATION) {
      segments.push({ start: currentStart, end: currentStart + MAX_SEGMENT_DURATION });
      currentStart += MAX_SEGMENT_DURATION;
    }
    segments.push({ start: currentStart, end: duration });
  }

  return segments;
}

/**
 * Parse custom segmentation string.
 * Format: "0,5|6,10"     = two segments: 0-5, 6-10
 *         "0,5|6,10|"    = three segments: 0-5, 6-10, rest
 *         "0,5|6,10|11," = three segments: 0-5, 6-10, 11-end
 */
export function segmentByCustom(customRanges: string, duration: number): SegmentBoundary[] {
  const segments: SegmentBoundary[] = [];
  if (!customRanges) return segments;
  const parts = customRanges.split("|");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!p && i < parts.length - 1) continue;
    const [ss, se] = p.split(",");
    const start = parseFloat(ss);
    if (isNaN(start) || start < 0) continue;
    if (start >= duration) continue;
    if (se !== undefined && se.trim() !== "") {
      const end = parseFloat(se);
      if (isNaN(end) || end <= start) continue;
      segments.push({ start, end: Math.min(end, duration) });
    } else if (i === parts.length - 1) {
      segments.push({ start, end: duration });
    }
  }
  return segments;
}
