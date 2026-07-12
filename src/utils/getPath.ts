import path from "path";
import os from "os";

export function getAppRoot(): string {
  return path.resolve(__dirname, "..");
}

export function getDataPath(...segments: string[]): string {
  return path.resolve(getAppRoot(), "data", ...segments);
}

export function getOssPath(...segments: string[]): string {
  return getDataPath("oss", ...segments);
}

export function isElectron(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions &&
    !!process.versions.electron
  );
}
