import fs from "fs";
import path from "path";
import { getDataPath } from "./utils/getPath";

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// Ensure data directories exist on startup
export function ensureDataDirs(): void {
  const dirs = [
    getDataPath("oss"),
    getDataPath("vendor"),
    getDataPath("oss"),
  ];
  dirs.forEach(ensureDir);
}
