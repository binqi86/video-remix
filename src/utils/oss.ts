import fs from "fs";
import path from "path";
import { getOssPath } from "./getPath";

export class Oss {
  private basePath: string;

  constructor() {
    this.basePath = getOssPath();
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  resolve(relativePath: string): string {
    return path.join(this.basePath, relativePath);
  }

  writeFile(relativePath: string, data: Buffer | string): string {
    const fullPath = this.resolve(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
    return relativePath;
  }

  readFile(relativePath: string): Buffer {
    return fs.readFileSync(this.resolve(relativePath));
  }

  readFileAsBase64(relativePath: string): string {
    const buffer = this.readFile(relativePath);
    return buffer.toString("base64");
  }

  deleteFile(relativePath: string): void {
    const fullPath = this.resolve(relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  deleteDirectory(relativePath: string): void {
    const fullPath = this.resolve(relativePath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  exists(relativePath: string): boolean {
    return fs.existsSync(this.resolve(relativePath));
  }

  getFileUrl(relativePath: string): string {
    return `/oss/${relativePath}`;
  }
}

export const oss = new Oss();
