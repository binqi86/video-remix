import { app, BrowserWindow, protocol, nativeImage } from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import startServe, { closeServe as closeBackend } from "../src/app";

const CANVAS_PORT = 3000;
const CANVAS_DIR = path.resolve(__dirname, "..", "infinite-canvas", "web");

let mainWindow: BrowserWindow | null = null;
let canvasProcess: ChildProcess | null = null;

// Set app name for dock tooltip and macOS menu bar
// Note: In dev mode (unpackaged), macOS shows "Electron" in the dock
// because the app runs from Electron.app bundle. Packaged with electron-builder,
// the productName "Video Remix" from package.json will be used automatically.
try { app.name = "Video Remix"; } catch (e) {}

// Set dock icon
try {
  const iconPath = path.join(process.cwd(), "build", "icon.png");
  const fs = require("fs");
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") app.dock.setIcon(img);
  }
} catch (e) {
  // Icon is optional
}

function startInfiniteCanvas(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if infinite-canvas exists
    const fs = require("fs");
    if (!fs.existsSync(CANVAS_DIR)) {
      console.warn(`[Canvas] infinite-canvas 项目不存在: ${CANVAS_DIR}`);
      console.warn(`[Canvas] 请从 https://github.com/basketikun/infinite-canvas 克隆到同级目录`);
      resolve(); // Don't block startup
      return;
    }

    console.log(`[Canvas] 启动 infinite-canvas (${CANVAS_DIR})...`);
    canvasProcess = spawn("bun", ["run", "dev"], {
      cwd: CANVAS_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(CANVAS_PORT) },
    });

    canvasProcess.stdout?.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("localhost:3000") || msg.includes("ready")) {
        console.log(`[Canvas] infinite-canvas 已启动: http://localhost:${CANVAS_PORT}`);
        resolve();
      }
    });

    canvasProcess.stderr?.on("data", (data: Buffer) => {
      // Next.js outputs to stderr too
      const msg = data.toString();
      if (msg.includes("localhost:3000") || msg.includes("ready")) {
        console.log(`[Canvas] infinite-canvas 已启动: http://localhost:${CANVAS_PORT}`);
        resolve();
      }
    });

    canvasProcess.on("error", (err) => {
      console.error(`[Canvas] 启动失败:`, err.message);
      resolve(); // Don't block main app
    });

    canvasProcess.on("exit", (code) => {
      console.log(`[Canvas] 进程退出 (code: ${code})`);
      canvasProcess = null;
    });

    // Timeout after 30s - don't block main app
    setTimeout(() => resolve(), 30000);
  });
}

function createMainWindow(port: number): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: "Video Remix",
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      },
    });
    mainWindow = win;
    win.setMenuBarVisibility(false);
    win.removeMenu();

    win.on("closed", () => { mainWindow = null; });

    win.once("ready-to-show", () => {
      win.show();
      resolve();
    });

    // Open DevTools on F12 for debugging
    win.webContents.on("before-input-event", (_, input) => {
      if (input.key === "F12") {
        win.webContents.toggleDevTools();
      }
    });

    // Load frontend from backend server
    win.loadURL(`http://localhost:${port}`);
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "videoremix",
    privileges: { secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

app.whenReady().then(async () => {
  try {
    // Step 1: Start video-remix backend (port from config or default 3001)
    const port = await startServe(false);
    process.env.PORT = String(port);
    console.log(`[App] 后端服务: http://localhost:${port}`);

    // Step 2: Start tunnel (if configured)
    let tunnelUrl: string | null = null;
    try {
      const { getTunnelConfig, createTunnelProvider } = require("../src/utils/tunnel");
      const tunnelConfig = getTunnelConfig();
      if (tunnelConfig.provider !== "none") {
        console.log(`[Tunnel] 启动隧道 (${tunnelConfig.provider})...`);
        const tunnel = createTunnelProvider(tunnelConfig.provider);
        const info = await tunnel.start(tunnelConfig);
        tunnelUrl = info.url;
        console.log(`[Tunnel] 公网地址: ${info.url}`);
        // Save for the frontend to use
        process.env.TUNNEL_URL = info.url;
      }
    } catch (err: any) {
      console.warn(`[Tunnel] 启动失败（不影响主应用）: ${err.message}`);
    }

    // Step 3: Start infinite-canvas in background
    startInfiniteCanvas();

    // Step 3: Register custom protocol
    protocol.handle("videoremix", (request) => {
      const url = new URL(request.url);
      const pathname = url.hostname.toLowerCase();
      const handlers: Record<string, () => object> = {
        getappurl: () => ({ url: `http://localhost:${port}/api` }),
        windowminimize: () => { mainWindow?.minimize(); return { ok: true }; },
        windowmaximize: () => {
          mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
          return { ok: true };
        },
        windowclose: () => { app.exit(0); return { ok: true }; },
        apprestart: () => {
          setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
          return { ok: true, message: "重启中" };
        },
        windowismaximized: () => ({ maximized: mainWindow?.isMaximized() ?? false }),
        opendevtool: () => { mainWindow?.webContents.openDevTools(); return { ok: true }; },
      };
      const handler = handlers[pathname];
      return new Response(JSON.stringify(handler ? handler() : { error: "unknown" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await createMainWindow(port);
  } catch (err) {
    console.error("[App] 启动失败:", err);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(parseInt(process.env.PORT || "3001"));
  }
});

app.on("before-quit", async () => {
  // Cleanup: kill infinite-canvas process
  if (canvasProcess) {
    canvasProcess.kill();
    canvasProcess = null;
  }
  await closeBackend().catch(() => {});
});
