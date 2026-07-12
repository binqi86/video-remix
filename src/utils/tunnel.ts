import { spawn, ChildProcess } from "child_process";
import http from "http";
import { EventEmitter } from "events";

export interface TunnelConfig {
  provider: "cloudflared" | "localtunnel" | "none";
  port: number;
}

export interface TunnelInfo {
  url: string;
  provider: string;
}

// Abstract tunnel interface
export interface TunnelProvider {
  readonly name: string;
  start(config: TunnelConfig): Promise<TunnelInfo>;
  stop(): Promise<void>;
  getUrl(): string | null;
}

// ---- Cloudflared Implementation ----

class CloudflaredTunnel extends EventEmitter implements TunnelProvider {
  readonly name = "cloudflared";
  private process: ChildProcess | null = null;
  private url: string | null = null;

  async start(config: TunnelConfig): Promise<TunnelInfo> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${config.port}`], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let resolved = false;

        this.process.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          // Cloudflared outputs the URL like: https://xxx.trycloudflare.com
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) {
            resolved = true;
            this.url = match[0];
            this.emit("url", this.url);
            resolve({ url: this.url, provider: this.name });
          }
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          // Cloudflared sometimes outputs URL to stderr
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) {
            resolved = true;
            this.url = match[0];
            this.emit("url", this.url);
            resolve({ url: this.url, provider: this.name });
          }
        });

        this.process.on("error", (err) => {
          if (!resolved) {
            reject(new Error(`cloudflared 启动失败: ${err.message}`));
          }
        });

        this.process.on("exit", (code) => {
          if (!resolved) {
            reject(new Error(`cloudflared 进程退出 (code: ${code})`));
          }
          this.process = null;
          this.url = null;
        });

        // Timeout after 15 seconds
        setTimeout(() => {
          if (!resolved) {
            reject(new Error("cloudflared 启动超时（15s），请确认已安装: brew install cloudflared"));
          }
        }, 15000);
      } catch (err: any) {
        reject(new Error(`cloudflared 启动失败: ${err.message}`));
      }
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.url = null;
  }

  getUrl(): string | null {
    return this.url;
  }
}

// ---- Null Tunnel (no tunnel, local-only mode) ----

class NullTunnel implements TunnelProvider {
  readonly name = "none";

  async start(_config: TunnelConfig): Promise<TunnelInfo> {
    throw new Error("未启用隧道");
  }

  async stop(): Promise<void> {
    // nothing to do
  }

  getUrl(): string | null {
    return null;
  }
}

// ---- Factory ----

export function createTunnelProvider(type: string): TunnelProvider {
  switch (type) {
    case "cloudflared":
      return new CloudflaredTunnel();
    case "none":
      return new NullTunnel();
    default:
      return new NullTunnel();
  }
}

// ---- Config management ----

const TUNNEL_CONFIG_KEY = "tunnel_config";

export function getTunnelConfig(): TunnelConfig {
  try {
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(process.cwd(), "data", "tunnel-config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {}
  return { provider: "none", port: 3001 };
}

export function saveTunnelConfig(config: TunnelConfig): void {
  const fs = require("fs");
  const path = require("path");
  const configPath = path.join(process.cwd(), "data", "tunnel-config.json");
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function checkCloudflared(): boolean {
  try {
    const result = require("child_process").execSync("which cloudflared", { stdio: "pipe" });
    return result.toString().trim().length > 0;
  } catch {
    return false;
  }
}
