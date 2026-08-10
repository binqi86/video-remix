import { db } from "../../utils/db";

export const MAX_SPEECH_AUDIOS = 3; // Seedance reference audio limit
export const MIN_SPEECH_DURATION_MS = 2000;
export const MAX_SPEECH_DURATION_MS = 15000;
export const MAX_SPEECH_TOTAL_MS = 15000;

export interface SpeechAudio {
  fileName: string;
  path: string;
  durationMs: number;
}

export function parseSpeechAudios(raw: string | null | undefined): SpeechAudio[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function isProjectGenerating(projectId: number): Promise<boolean> {
  const project = await db("o_project").where("id", projectId).first();
  if (!project) return false;
  if (project.status === "generating") return true;
  const segs = await db("o_segment").where("projectId", projectId).all();
  return segs.some((s: any) => s.imageGenState === "generating" || s.videoGenState === "generating");
}
