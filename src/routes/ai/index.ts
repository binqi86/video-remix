import { Router, Request, Response } from "express";
import { db } from "../../utils/db";
import { PORT } from "../../env";
import { getDataPath } from "../../utils/getPath";
import { getSuppliers, getActiveSupplier, getPollTimeout } from "../../utils/supplier";

const router = Router();

// ---- Simple multipart parser (no dependencies) ----
function parseMultipartRaw(body: Buffer, boundary: string): { fields: Record<string, string>; files: Record<string, Buffer> } {
  const fields: Record<string, string> = {};
  const files: Record<string, Buffer> = {};
  const delimiter = Buffer.from(`--${boundary}`);
  const endDelimiter = Buffer.from(`--${boundary}--`);
  let pos = 0;

  while (pos < body.length) {
    const start = body.indexOf(delimiter, pos);
    if (start === -1) break;
    const end = body.indexOf(delimiter, start + delimiter.length);
    if (end === -1) break;
    const part = body.slice(start + delimiter.length, end);
    pos = end;

    // Skip the final boundary
    if (part.length === 0 || (part.length === 2 && part[0] === 45 && part[1] === 45)) continue;
    if (body.slice(start, start + endDelimiter.length).equals(endDelimiter)) break;

    // Find header/body separator (\r\n\r\n)
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerSection = part.slice(0, headerEnd).toString("utf-8").toLowerCase();
    const dataStart = headerEnd + 4;
    // Remove trailing \r\n
    const dataEnd = part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10 ? part.length - 2 : part.length;
    const data = part.slice(dataStart, dataEnd);

    // Extract name from Content-Disposition
    const nameMatch = headerSection.match(/name="([^"]*)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    // Check if it's a file (has filename)
    const filenameMatch = headerSection.match(/filename="([^"]*)"/);
    if (filenameMatch) {
      files[name] = data;
    } else {
      fields[name] = data.toString("utf-8");
    }
  }

  return { fields, files };
}

// ---- Endpoint mapping config ----
interface EndpointMapping {
  from: string;
  to: string;
  imageField?: string;      // multipart file field to convert (e.g., "image")
  imageTarget?: string;     // target JSON field for images (e.g., "image_urls")
  passthroughFields?: string[];  // which form fields to pass through
}

let endpointMappings: EndpointMapping[] = [];

async function loadMappings(): Promise<void> {
  try {
    const setting = await db("o_setting").where("key", "endpointMappings").first();
    if (setting?.value) {
      endpointMappings = JSON.parse(setting.value);
    } else {
      endpointMappings = [];
    }
  } catch { endpointMappings = []; }
}

// ---- Helper functions ----
function replaceLocalUrls(obj: any, tunnelUrl: string): any {
  if (typeof obj === "string") {
    if (obj.match(/^https?:\/\/localhost:\d+\//)) return obj.replace(/^https?:\/\/localhost:\d+/, tunnelUrl);
    if (obj.startsWith("/oss/")) return tunnelUrl + obj;
    return obj;
  }
  if (Array.isArray(obj)) return obj.map((item) => replaceLocalUrls(item, tunnelUrl));
  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const key of Object.keys(obj)) result[key] = replaceLocalUrls(obj[key], tunnelUrl);
    return result;
  }
  return obj;
}

function hasLocalFiles(obj: any): boolean {
  if (typeof obj === "string") return !!obj.match(/^https?:\/\/localhost:\d+\//) || obj.startsWith("/oss/");
  if (Array.isArray(obj)) return obj.some((item) => hasLocalFiles(item));
  if (obj && typeof obj === "object") return Object.values(obj).some((val) => hasLocalFiles(val));
  return false;
}

async function getTargetBaseUrl(): Promise<string | null> {
  try {
    const setting = await db("o_setting").where("key", "aiProxyTargetUrl").first();
    return setting?.value || null;
  } catch { return null; }
}

async function getTimeoutMs(): Promise<number> {
  try { return getPollTimeout(); } catch { return 1800000; }
}

async function pollTask(targetBase: string, taskId: string, authHeader: string | undefined, maxWait?: number): Promise<any> {
  if (!maxWait) maxWait = await getTimeoutMs();
  const startTime = Date.now();
  // Remove trailing /v1 if present, then add /v1/tasks/{taskId}
  const base = targetBase.replace(/\/v1\/?$/, "");
  const taskUrl = `${base}/v1/tasks/${taskId}`;
  console.log(`[Poll] 轮询: ${taskUrl}`);
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 30 === 0) {
        console.log(`[Poll] 等待中... ${elapsed}s / ${maxWait / 1000}s (${taskId})`);
      }
      const res = await fetch(taskUrl, { headers: { ...(authHeader ? { Authorization: authHeader } : {}) } });
      const data = await res.json();
      if (data.code === 200 && data.data) {
        if (data.data.status === "completed") return data.data;
        if (data.data.status === "failed") throw new Error(data.data.error?.message || "任务失败");
      }
    } catch (err: any) {
      if (err.message !== "任务失败") continue;
      throw err;
    }
  }
  throw new Error("轮询超时");
}

function toOpenAIFormat(taskResult: any, prompt: string): any {
  const images = taskResult.result?.images || [];
  return { created: Math.floor(Date.now() / 1000), data: images.map((img: any) => ({ url: Array.isArray(img.url) ? img.url[0] : img.url })) };
}

// Cache for completed video tasks (avoids re-polling on GET)
const videoTaskCache = new Map<string, any>();

// ---- Routes ----

router.options(["/proxy", "/proxy/*"], (_req: Request, res: Response) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Target-Base-Url");
  res.sendStatus(204);
});

// Config endpoint for mappings
router.get("/proxy/mappings", async (_req: Request, res: Response) => {
  await loadMappings();
  res.json({ success: true, data: endpointMappings });
});

router.post("/proxy/mappings", async (req: Request, res: Response) => {
  try {
    const value = JSON.stringify(req.body.mappings || []);
    const { exec } = await import("../../utils/db");
    exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["endpointMappings", value]);
    endpointMappings = [...DEFAULT_MAPPINGS, ...(req.body.mappings || [])];
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Main proxy handler
router.all(["/proxy", "/proxy/*"], async (req: Request, res: Response) => {
  const subPath = req.path.replace(/^\/proxy/, "") || "/chat/completions";
  const startTime = Date.now();
  const reqId = Date.now().toString(36);
  const contentType = req.headers["content-type"] || "";
  const isMultipart = contentType.includes("multipart/form-data");

  console.log(`[AI Proxy][${reqId}] ${req.method} ${subPath}`);

  let targetUrl = "";
  let _mapped = false; // track if endpoint mapping was applied

  try {
    // Resolve supplier by API key (supports multiple suppliers with different keys)
    const suppliers = await getSuppliers();
    const requestAuth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    // Find supplier whose API key matches the request's auth header
    let supplier = suppliers.find((s: any) => s.enabled && s.apiKey === requestAuth);
    if (!supplier) {
      // Fallback: first enabled supplier (legacy behavior)
      supplier = suppliers.find((s: any) => s.enabled);
    }

    let targetBaseUrl = req.headers["x-target-base-url"] as string;
    if (!targetBaseUrl) targetBaseUrl = await getTargetBaseUrl();
    // Override with supplier's baseUrl
    if (supplier?.baseUrl) targetBaseUrl = supplier.baseUrl;

    if (!targetBaseUrl) {
      return res.status(400).json({ error: { message: "缺少目标 API 地址", type: "config_error" } });
    }

    // Override auth header with supplier's API key
    if (supplier?.apiKey) {
      req.headers.authorization = `Bearer ${supplier.apiKey}`;
      console.log(`[AI Proxy][${reqId}] 使用供应商: ${supplier.name}`);
    } else {
      console.log(`[AI Proxy][${reqId}] 未匹配到供应商，使用原始 API Key`);
    }

    await loadMappings();
    let cleanBase = targetBaseUrl.replace(/\/+$/, "");
    let cleanSub = subPath;

    // ---- Handle video task status polling (GET /v1/contents/generations/tasks/{taskId}) ----
    // Only for suppliers with endpoint mappings (ApiMart-style). Others pass through to standard forwarding.
    if (req.method === "GET") {
      const taskMatch = subPath.match(/^\/v1\/contents\/generations\/tasks\/(.+)$/);
      if (taskMatch && supplier?.endpointMappings?.length) {
        const taskId = taskMatch[1];
        // Check cache first (from POST polling)
        const cached = videoTaskCache.get(taskId);
        if (cached) return res.json(cached);
        console.log(`[AI Proxy][${reqId}] 视频任务状态查询: ${taskId} (${supplier.name})`);

        // Build task URL with /v1 dedup for /api/v3 base URLs
        let baseWithoutV1 = cleanBase.replace(/\/v1\/?$/, "");
        if (/\/api\/v\d+$/i.test(baseWithoutV1)) baseWithoutV1 = baseWithoutV1;
        const taskUrl = `${baseWithoutV1}/v1/tasks/${encodeURIComponent(taskId)}`;
        const authHeader = req.headers.authorization;

        try {
          const pollRes = await fetch(taskUrl, {
            headers: { ...(authHeader ? { Authorization: authHeader } : {}) },
          });
          const pollData: any = await pollRes.json();

          // Transform apimart format → Seedance format
          if (pollData.code === 200 && pollData.data) {
            const taskData: any = pollData.data;
            const statusMap: Record<string, string> = {
              completed: "succeeded",
              failed: "failed",
              running: "running",
              queued: "queued",
              submitted: "queued",
            };
            const seedanceStatus = statusMap[taskData.status] || "queued";

            const result: any = {
              code: 0,
              data: { id: taskId, status: seedanceStatus },
            };

            if (seedanceStatus === "succeeded") {
              result.data.content = {};
              // apimart video results: result.videos[0].url[0]
              const videoUrl = taskData.result?.videos?.[0]?.url?.[0];
              if (videoUrl) result.data.content.video_url = videoUrl;
              // fallback: check last_frame_url at top level
              if (taskData.result?.last_frame_url) result.data.content.last_frame_url = taskData.result.last_frame_url;
            } else if (seedanceStatus === "failed") {
              result.data.error = { message: taskData.error?.message || "视频生成失败", code: taskData.error?.code };
            }

            return res.json(result);
          }

          return res.status(pollRes.status).json(pollData);
        } catch (err: any) {
          console.error(`[AI Proxy][${reqId}] 任务状态查询失败: ${err.message}`);
          return res.json({
            code: 0,
            data: { id: taskId, status: "failed", error: { message: `任务状态查询失败: ${err.message}` } },
          });
        }
      }
    }

    // ---- Endpoint mapping: check if this endpoint should be transformed ----
    // Use supplier-specific mappings when matched by API key, otherwise global defaults
    const supplierMaps = supplier?.endpointMappings || [];
    // Check if the supplier was matched by API key vs. first-enabled fallback
    const matchedByKey = supplier && supplier.apiKey === requestAuth;
    const allMaps = matchedByKey ? supplierMaps : [...endpointMappings, ...supplierMaps.filter(sm => !endpointMappings.find(em => em.from === sm.from))];
    const mapping = allMaps.find(m => cleanSub.startsWith(m.from));
    if (mapping) {
      if (isMultipart) {
        // Multipart → JSON conversion (e.g., edits → generations)
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks);
      const boundary = contentType.split("boundary=")[1]?.trim();
      if (!boundary) return res.status(400).json({ error: { message: "缺少 multipart boundary" } });

      // Parse multipart
      const { fields, files } = parseMultipartRaw(rawBody, boundary);

      // Build new JSON body for target endpoint
      const newBody: any = {};
      const numericFields = ["n", "max_tokens", "temperature", "top_p"];
      for (const f of (mapping.passthroughFields || [])) {
        if (fields[f] !== undefined) {
          newBody[f] = numericFields.includes(f) ? Number(fields[f]) : fields[f];
        }
      }
      // Convert image file to base64 data URI
      if (mapping.imageField && files[mapping.imageField] && mapping.imageTarget) {
        const ext = fields["image_type"] || "png";
        const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/webp";
        const b64 = files[mapping.imageField].toString("base64");
        newBody[mapping.imageTarget] = [`data:${mime};base64,${b64}`];
      }

      // Change target endpoint with dedup
      cleanSub = mapping.to;
      const mLastSeg = cleanBase.split("/").pop() || "";
      const mFirstSeg = cleanSub.split("/")[1] || "";
      if (mLastSeg && mFirstSeg && mLastSeg === mFirstSeg) cleanSub = cleanSub.replace(new RegExp("^/" + mLastSeg), "");
      else if (/\/api\/v\d+$/i.test(cleanBase) && cleanSub.startsWith("/v1/")) cleanSub = cleanSub.replace(/^\/v1/, "");
      targetUrl = cleanBase + cleanSub;
      console.log(`[AI Proxy][${reqId}] 映射: ${subPath} → ${targetUrl}`);

      // Forward as JSON
      const fetchRes = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        },
        body: JSON.stringify(newBody),
        signal: AbortSignal.timeout(600000),
      });

      const text = await fetchRes.text();
      console.log(`[AI Proxy][${reqId}] ← ${fetchRes.status} (${Date.now() - startTime}ms, ${text.length} bytes)`);

      if (fetchRes.status !== 200 && fetchRes.status !== 201) {
        console.log(`[AI Proxy][${reqId}] ⚠️ ${text.slice(0, 300)}`);
      }

      let json: any;
      try { json = JSON.parse(text); } catch {
        return res.status(fetchRes.status).json({ error: { message: `API 返回了非 JSON`, type: "api_error" } });
      }

      // Handle async task
      if (json.code === 200 && Array.isArray(json.data) && json.data[0]?.task_id) {
        console.log(`[AI Proxy][${reqId}] 异步任务: ${json.data[0].task_id}，轮询中...`);
        const taskResult = await pollTask(cleanBase, json.data[0].task_id, req.headers.authorization);
        const openAIRes = toOpenAIFormat(taskResult, newBody.prompt || "");
        console.log(`[AI Proxy][${reqId}] ✅ 完成 (${Date.now() - startTime}ms)`);
        return res.json(openAIRes);
      }

      return res.status(fetchRes.status).json(json);
    } else {
      // Non-multipart mapping: rewrite URL path, forward original body
      const mLastSeg = cleanBase.split("/").pop() || "";
      const mFirstSeg = mapping.to.split("/")[1] || "";
      cleanSub = mapping.to;
      if (mLastSeg && mFirstSeg && mLastSeg === mFirstSeg) cleanSub = cleanSub.replace(new RegExp("^/" + mLastSeg), "");
      else if (/\/api\/v\d+$/i.test(cleanBase) && cleanSub.startsWith("/v1/")) cleanSub = cleanSub.replace(/^\/v1/, "");
      targetUrl = cleanBase + cleanSub;
      console.log(`[AI Proxy][${reqId}] 路径映射: ${subPath} → ${targetUrl}`);
      _mapped = true;

      // Convert OpenAI content array format to video API format
      const requestBody: any = req.body ? { ...req.body } : {};
      if (requestBody.content && Array.isArray(requestBody.content)) {
        const texts = requestBody.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
        const images = requestBody.content
          .filter((c: any) => c.type === "image_url")
          .map((c: any) => c.image_url?.url)
          .filter(Boolean);

        const converted: any = {};
        converted.model = requestBody.model || "doubao-seedance-2.0";
        if (texts) converted.prompt = texts;
        if (requestBody.duration !== undefined) converted.duration = requestBody.duration;
        if (requestBody.ratio) converted.size = requestBody.ratio;
        if (requestBody.resolution) converted.resolution = requestBody.resolution;
        if (requestBody.generate_audio !== undefined) converted.generate_audio = requestBody.generate_audio;

        // Convert base64 data URIs to file URLs via OSS + tunnel
        const tunnelUrl = process.env.TUNNEL_URL || "";
        const fs = require("fs");
        const path = require("path");
        const ossDir = path.join(getDataPath("oss"), "_proxy");
        if (!fs.existsSync(ossDir)) fs.mkdirSync(ossDir, { recursive: true });

        function saveBase64ToUrl(dataUri: string, prefix: string): string {
          const tun = tunnelUrl || process.env.TUNNEL_URL || "";
          if (dataUri.startsWith("data:")) {
            const match = dataUri.match(/^data:(\w+)\/(\w+);base64,(.+)$/);
            if (match) {
              const ext = match[2] === "jpeg" ? "jpg" : match[2];
              const buf = Buffer.from(match[3], "base64");
              // Use content hash as filename to dedup
              const hash = require("crypto").createHash("md5").update(buf).digest("hex").slice(0, 10);
              const fileName = `${prefix}_${hash}.${ext}`;
              const filePath = path.join(ossDir, fileName);
              if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buf);
              const baseUrl = tun || `http://localhost:${PORT}`;
              return `${baseUrl}/oss/_proxy/${fileName}`;
            }
          }
          if (dataUri.match(/^https?:\/\/localhost:\d+\/oss\//)) {
            const baseUrl = tun || `http://localhost:${PORT}`;
            console.log(`[AI Proxy] 替换本地URL: ${dataUri.slice(0, 80)} → ${baseUrl}`);
            return dataUri.replace(/^https?:\/\/localhost:\d+/, baseUrl);
          }
          return dataUri;
        }

        // Images
        if (images.length > 0) {
          converted.image_urls = images.map((img: string, i: number) => saveBase64ToUrl(img, `img_${i}`));
        }

        // Videos (from content array with type "video_url")
        const videoEntries = requestBody.content.filter((c: any) => c.type === "video_url").map((c: any) => c.video_url?.url).filter(Boolean);
        if (videoEntries.length > 0) {
          console.log(`[AI Proxy][${reqId}] 视频引用:`, videoEntries.map((v: string) => v.slice(0, 120)));
          converted.video_urls = videoEntries.map((v: string, i: number) => {
            if (v.startsWith("blob:")) {
              // Can't access blob URLs from backend - skip
              console.log(`[AI Proxy][${reqId}] ⚠️ 跳过 blob 视频引用，无法从后端访问`);
              return v;
            }
            return saveBase64ToUrl(v, `vid_${i}`);
          });
        }

        // Audios (from content array with type "audio_url")
        const audioEntries = requestBody.content.filter((c: any) => c.type === "audio_url").map((c: any) => c.audio_url?.url).filter(Boolean);
        if (audioEntries.length > 0) {
          console.log(`[AI Proxy][${reqId}] 音频引用:`, audioEntries.map((a: string) => a.slice(0, 120)));
          converted.audio_urls = audioEntries.map((a: string, i: number) => {
            if (a.startsWith("blob:")) {
              console.log(`[AI Proxy][${reqId}] ⚠️ 跳过 blob 音频引用，无法从后端访问`);
              return a;
            }
            return saveBase64ToUrl(a, `aud_${i}`);
          });
        }

        console.log(`[AI Proxy][${reqId}] 格式转换: content[] → prompt + ${converted.image_urls?.length || 0}张图片 + ${converted.video_urls?.length || 0}个视频 + ${converted.audio_urls?.length || 0}个音频`);
        // Log tunnel URLs, one per line
        const tunnelLines: string[] = [];
        if (converted.image_urls?.length) converted.image_urls.forEach((url: string) => tunnelLines.push(`  img: ${url}`));
        if (converted.video_urls?.length) converted.video_urls.forEach((url: string) => tunnelLines.push(`  vid: ${url}`));
        if (converted.audio_urls?.length) converted.audio_urls.forEach((url: string) => tunnelLines.push(`  aud: ${url}`));
        if (tunnelLines.length) console.log(`[AI Proxy][${reqId}] 公网地址:\n${tunnelLines.join("\n")}`);
        // Replace the request body for downstream
        (req as any).__convertedBody = converted;
      }
    }
    }

    // ---- Standard forwarding (also reached from mapped non-multipart paths) ----
    if (!_mapped) {
      const lastSeg = cleanBase.split("/").pop() || "";
      const firstSeg = cleanSub.split("/")[1] || "";
      if (lastSeg && firstSeg && lastSeg === firstSeg) cleanSub = cleanSub.replace(new RegExp("^/" + lastSeg), "");
      // Also strip /v1 prefix when base uses /api/v3 (e.g. ByteDance)
      if (/\/api\/v\d+$/i.test(cleanBase) && cleanSub.startsWith("/v1/")) cleanSub = cleanSub.replace(/^\/v1/, "");
      targetUrl = cleanBase + cleanSub;
    }
    const authHeader = req.headers.authorization;

    let response: Response;
    const requestBody: any = req.body ? { ...req.body } : {};

    if (isMultipart) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      response = await fetch(targetUrl, {
        method: req.method,
        headers: { "Content-Type": contentType, ...(authHeader ? { Authorization: authHeader } : {}) },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(600000),
      });
    } else {
      // Forward all original headers for compatibility
      const forwardedHeaders: Record<string, string> = {};
      const skipHeaders = ["host", "content-length", "transfer-encoding", "connection"];
      for (const [key, val] of Object.entries(req.headers)) {
        if (!skipHeaders.includes(key.toLowerCase()) && typeof val === "string") {
          forwardedHeaders[key] = val;
        }
      }
      // Ensure Content-Type is set
      if (!forwardedHeaders["content-type"]) forwardedHeaders["content-type"] = "application/json";
      delete requestBody.baseUrl;
      const hasLocal = hasLocalFiles(requestBody);
      let finalBody = requestBody;
      if (hasLocal) {
        const tunnelUrl = process.env.TUNNEL_URL;
        if (!tunnelUrl) return res.status(400).json({ error: { message: "需要启用隧道", type: "tunnel_required" } });
        finalBody = replaceLocalUrls(requestBody, tunnelUrl);
        // Log tunnel URLs, one per line
        const tunnelDomain = tunnelUrl.replace(/^https?:\/\//, "").split("/")[0];
        const urlLines: string[] = [];
        function scanUrls(obj: any): void {
          if (typeof obj === "string" && obj.startsWith("http") && obj.includes(tunnelDomain)) {
            urlLines.push(`  ${obj.length > 120 ? obj.slice(0, 120) + "..." : obj}`);
          } else if (Array.isArray(obj)) obj.forEach(scanUrls);
          else if (obj && typeof obj === "object") Object.values(obj).forEach(scanUrls);
        }
        scanUrls(finalBody);
        if (urlLines.length) console.log(`[AI Proxy][${reqId}] 公网地址:\n${urlLines.join("\n")}`);
      }

      // Count media items in content array (for debugging even when no tunnel rewrite)
      const contentArr = requestBody.content;
      if (Array.isArray(contentArr)) {
        const imgCount = contentArr.filter((c: any) => c.type === "image_url").length;
        const vidCount = contentArr.filter((c: any) => c.type === "video_url").length;
        const audCount = contentArr.filter((c: any) => c.type === "audio_url").length;
        const b64Imgs = hasLocal ? 0 : contentArr.filter((c: any) => c.type === "image_url" && c.image_url?.url?.startsWith("data:")).length;
        if (!hasLocal && (b64Imgs || vidCount)) {
          const parts: string[] = [];
          if (b64Imgs) parts.push(`内联图片${b64Imgs}张`);
          if (vidCount) parts.push(`视频${vidCount}个`);
          console.log(`[AI Proxy][${reqId}] 素材: ${parts.join(", ")}`);
        }
      }

      // Debug: log request info for video/image generation
      if (subPath.includes("video") || subPath.includes("image") || subPath.includes("content")) {
        const logBody = { ...finalBody };
        // Truncate large fields for logging
        for (const k of Object.keys(logBody)) {
          if (typeof logBody[k] === "string" && logBody[k].length > 200) logBody[k] = logBody[k].slice(0, 200) + "...";
          if (Array.isArray(logBody[k])) logBody[k] = logBody[k].slice(0, 3);
        }
        console.log(`[AI Proxy][${reqId}] 请求体:`, JSON.stringify(logBody).slice(0, 1000));
      }
      // Use converted body if available (from endpoint mapping transformation)
      const useBody = (req as any).__convertedBody || finalBody;

      // Log the actual request sent to the upstream API (useful for debugging apimart params)
      if (req.method !== "GET") {
        const logSafeBody: any = {};
        if (Array.isArray(useBody)) {
          logSafeBody._arrayLength = useBody.length;
        } else if (typeof useBody === "object" && useBody) {
          for (const [k, v] of Object.entries(useBody)) {
            if (k === "content" || k === "image_urls" || k === "video_urls" || k === "audio_urls") {
              const arr = v as any[];
              logSafeBody[k] = arr ? `[${arr.length} items]` : v;
            } else if (typeof v === "string" && v.length > 120) {
              logSafeBody[k] = v.slice(0, 120) + "...";
            } else {
              logSafeBody[k] = v;
            }
          }
        }
        console.log(`[AI Proxy][${reqId}] → ${req.method} ${targetUrl} body:${JSON.stringify(logSafeBody)}`);
      } else {
        console.log(`[AI Proxy][${reqId}] → ${req.method} ${targetUrl}`);
      }

      response = await fetch(targetUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: req.method !== "GET" ? JSON.stringify(useBody) : undefined,
        signal: AbortSignal.timeout(600000),
      });
    }

    // Check if response is SSE stream - pipe directly without parsing
    const respContentType = response.headers.get("content-type") || "";
    if (respContentType.includes("text/event-stream")) {
      console.log(`[AI Proxy][${reqId}] ← SSE 流式响应`);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      // Pipe the response body directly to the client
      if (response.body) {
        const reader = response.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { res.end(); break; }
            res.write(value);
          }
        };
        pump().catch(err => {
          console.error(`[AI Proxy][${reqId}] 流式写入错误:`, err.message);
          if (!res.writableEnded) res.end();
        });
        req.on("close", () => reader.cancel());
        return;
      }
      return res.end();
    }

    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch {
      return res.status(response.status).json({ error: { message: `API 返回非 JSON (HTTP ${response.status})`, type: "api_error" } });
    }

    // Handle async task responses
    if (json.code === 200 && Array.isArray(json.data) && json.data[0]?.task_id) {
      const taskId = json.data[0].task_id;
      // For video generation (content[] converted), poll with supplier's timeout and cache result
      if ((req as any).__convertedBody) {
        console.log(`[AI Proxy][${reqId}] 视频异步任务: ${taskId}，轮询中...`);
        try {
          const taskResult = await pollTask(cleanBase, taskId, authHeader);
          // Extract video URL from result
          const videoUrl = taskResult?.result?.videos?.[0]?.url?.[0];
          const seedanceRes = {
            code: 0,
            data: {
              id: taskId,
              status: (videoUrl ? "succeeded" : "failed") as string,
              ...(videoUrl ? { content: { video_url: videoUrl } } : {}),
              ...(taskResult?.result?.last_frame_url ? { content: { last_frame_url: taskResult.result.last_frame_url } } : {}),
            },
          };
          // Cache for GET handler
          videoTaskCache.set(taskId, seedanceRes);
          // Clean cache after 5 min
          setTimeout(() => videoTaskCache.delete(taskId), 300000);
          console.log(`[AI Proxy][${reqId}] ✅ 视频完成 (${Date.now() - startTime}ms)`);
          return res.json(seedanceRes);
        } catch (pollErr: any) {
          console.error(`[AI Proxy][${reqId}] 视频轮询失败: ${pollErr.message}`);
          return res.json({ code: 0, data: { id: taskId, status: "failed", error: { message: pollErr.message } } });
        }
      }
      // For other async tasks (e.g. images), poll synchronously
      console.log(`[AI Proxy][${reqId}] 异步任务: ${json.data[0].task_id}，轮询中...`);
      const promptForResult = (req as any).__convertedBody?.prompt || requestBody.prompt || "";
      const taskResult = await pollTask(cleanBase, json.data[0].task_id, authHeader);
      const openAIRes = toOpenAIFormat(taskResult, promptForResult);
      console.log(`[AI Proxy][${reqId}] ✅ 完成 (${Date.now() - startTime}ms)`);
      return res.json(openAIRes);
    }

    // Log non-200 responses for debugging
    if (response.status !== 200 && response.status !== 201) {
      console.log(`[AI Proxy][${reqId}] ⚠️ ${req.method} ${targetUrl} → ${response.status} (${text.length} bytes): ${text.slice(0, 300)}`);
    }

    return res.status(response.status).json(json);

  } catch (err: any) {
    console.error(`[AI Proxy][${reqId}] ❌ ${err.message} (target: ${targetUrl})`);
    return res.status(500).json({ error: { message: `AI 代理失败: ${err.message}`, type: "proxy_error" } });
  }
});

export default router;
