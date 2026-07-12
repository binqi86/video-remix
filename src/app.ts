import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import fs from "fs";
import { PORT, NODE_ENV } from "./env";
import { errorHandler } from "./err";
import { initDB } from "./lib/initDB";
import { ensureDir, ensureDataDirs } from "./utils";
import { closeDb } from "./utils/db";
import { getDataPath } from "./utils/getPath";
import { logger } from "./logger";

// Import routes
import projectRoutes from "./routes/project/index";
import videoRoutes from "./routes/video/index";
import segmentRoutes from "./routes/segment/index";
import generateRoutes from "./routes/generate/index";
import taskRoutes from "./routes/task/index";
import assetRoutes from "./routes/asset/index";
import modelRoutes from "./routes/model/index";
import settingRoutes from "./routes/setting/index";
import importRoutes from "./routes/import/index";
import tunnelRoutes from "./routes/tunnel/index";
import aiRoutes from "./routes/ai/index";
import supplierRoutes from "./routes/supplier/index";
import appConfigRoutes from "./routes/appConfig/index";
import { readConfig } from "./utils/config";

export default async function startServe(randomPort: boolean = false) {
  ensureDataDirs();

  // Init DB
  await initDB();

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, { cors: { origin: "*" } });

  // Middleware
  app.use(morgan("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ extended: true, limit: "500mb" }));

  // Log ALL requests for debugging
  app.use((req, _res, next) => {
    if (req.path.startsWith("/api/ai/") || req.path.startsWith("/v1/")) {
      console.log(`[REQ] ${req.method} ${req.path} (from: ${req.headers.origin || "unknown"})`);
    }
    next();
  });

  // Static file serving for OSS
  const ossDir = getDataPath("oss");
  ensureDir(ossDir);
  app.use("/oss", express.static(ossDir, { maxAge: 0 }));

  // API Routes
  app.use("/api/project", projectRoutes);
  app.use("/api/video", videoRoutes);
  app.use("/api/segment", segmentRoutes);
  app.use("/api/generate", generateRoutes);
  app.use("/api/task", taskRoutes);
  app.use("/api/asset", assetRoutes);
  app.use("/api/model", modelRoutes);
  app.use("/api/setting", settingRoutes);
  app.use("/api/import", importRoutes);
  app.use("/api/tunnel", tunnelRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/supplier", supplierRoutes);
  app.use("/api/app", appConfigRoutes);

  // Read port from config if not using random port
  if (!randomPort) {
    const cfg = readConfig();
    if (cfg.appPort) {
      // Override PORT env for use elsewhere
      process.env.PORT = String(cfg.appPort);
    }
  }

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ success: true, message: "Video Remix API running" });
  });

  // Serve frontend static files (built from frontend/dist)
  const frontendDir = path.join(process.cwd(), "frontend", "dist");
  if (fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
    // SPA fallback: serve index.html for any non-API route
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDir, "index.html"));
    });
  }

  // Socket.IO
  io.on("connection", (socket) => {
    logger.info(`[Socket] 客户端连接: ${socket.id}`);

    socket.on("join:project", (projectId: number) => {
      socket.join(`project:${projectId}`);
      logger.info(`[Socket] ${socket.id} 加入项目 ${projectId}`);
    });

    socket.on("leave:project", (projectId: number) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on("disconnect", () => {
      logger.info(`[Socket] 客户端断开: ${socket.id}`);
    });
  });

  // Make io accessible to routes
  app.set("io", io);

  // Error handler
  app.use(errorHandler);

  // Read port: config > env > default
  const configuredPort = randomPort ? 0 : parseInt(process.env.PORT || String(PORT));
  let serverRef: http.Server | null = null;
  return new Promise<number>((resolve) => {
    server.listen(configuredPort, () => {
      serverRef = server;
      const actualPort = (server.address() as any).port;
      logger.info(`[Server] Video Remix API 运行在 http://localhost:${actualPort}`);
      resolve(actualPort);
    });
  });
}

export async function closeServe(): Promise<void> {
  await closeDb();
}

// Allow direct execution
if (require.main === module) {
  startServe().catch(console.error);
}
