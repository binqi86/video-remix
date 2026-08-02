import { exec, db, syncSave } from "./db";
import fs from "fs";
import path from "path";

export interface SupplierConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  tunnelEnabled: boolean;
  pollTimeout: number;   // seconds, default 1800
  endpointMappings: Array<{ from: string; to: string }>;
}

let cachedSuppliers: SupplierConfig[] | null = null;

// JSON file is the SOURCE OF TRUTH — survives DB corruption
const CONFIG_PATH = path.resolve(__dirname, "..", "data", "suppliers.json");
// Example config committed to GitHub (no real API keys)
const EXAMPLE_PATH = path.resolve(__dirname, "..", "data", "suppliers.example.json");

function writeConfigFile(suppliers: SupplierConfig[]): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(suppliers, null, 2));
  } catch (e) {
    console.error("[Supplier] 写入配置文件失败:", e.message);
  }
}

function readConfigFile(): SupplierConfig[] | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  return null;
}

function loadFromExample(): SupplierConfig[] {
  // Used when no local config exists (e.g. fresh clone from GitHub)
  try {
    if (fs.existsSync(EXAMPLE_PATH)) {
      const data = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

export async function getSuppliers(): Promise<SupplierConfig[]> {
  // 1. Read from JSON file (source of truth, real API keys)
  const fileSuppliers = readConfigFile();
  if (fileSuppliers) {
    cachedSuppliers = fileSuppliers;
    // Sync to DB (in case DB was wiped)
    try {
      exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["suppliers", JSON.stringify(fileSuppliers)]);
    } catch {}
    return fileSuppliers;
  }

  // 2. Fallback to example config (fresh clone from GitHub, no real keys)
  const exampleSuppliers = loadFromExample();
  if (exampleSuppliers.length > 0) {
    console.log("[Supplier] 使用示例配置，请在设置中填入 API Key");
    writeConfigFile(exampleSuppliers);
    cachedSuppliers = exampleSuppliers;
    try {
      exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["suppliers", JSON.stringify(exampleSuppliers)]);
    } catch {}
    return exampleSuppliers;
  }

  // 3. Fallback to DB
  try {
    const row = await db("o_setting").where("key", "suppliers").first();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      cachedSuppliers = parsed;
      // Persist to JSON file for future resilience
      if (Array.isArray(parsed) && parsed.length > 0) writeConfigFile(parsed);
      return parsed;
    }
  } catch {}

  if (!cachedSuppliers) cachedSuppliers = [];
  return cachedSuppliers;
}

export async function saveSuppliers(suppliers: SupplierConfig[]): Promise<void> {
  // Always write to JSON file first (source of truth)
  writeConfigFile(suppliers);
  // Then mirror to DB
  const value = JSON.stringify(suppliers);
  exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["suppliers", value]);
  syncSave();
  cachedSuppliers = suppliers;
}

export function getActiveSupplier(suppliers: SupplierConfig[]): SupplierConfig | null {
  return suppliers.find(s => s.enabled) || null;
}

export async function getPollTimeout(): Promise<number> {
  const suppliers = await getSuppliers();
  const active = getActiveSupplier(suppliers);
  return (active?.pollTimeout || 1800) * 1000;
}
