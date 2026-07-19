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
const BACKUP_PATH = path.resolve(__dirname, "..", "data", "suppliers.backup.json");

function backupToFile(suppliers: SupplierConfig[]): void {
  try {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(suppliers, null, 2));
  } catch {}
}

function restoreFromFile(): SupplierConfig[] {
  try {
    if (fs.existsSync(BACKUP_PATH)) {
      return JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
    }
  } catch {}
  return [];
}

export async function getSuppliers(): Promise<SupplierConfig[]> {
  try {
    const row = await db("o_setting").where("key", "suppliers").first();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      cachedSuppliers = parsed;
      return parsed;
    }
  } catch {}
  // DB is empty — try to restore from backup file
  const backup = restoreFromFile();
  if (backup.length > 0) {
    console.log("[Supplier] 从备份文件恢复供应商配置");
    await saveSuppliers(backup);
    return backup;
  }
  if (!cachedSuppliers) cachedSuppliers = [];
  return cachedSuppliers;
}

export async function saveSuppliers(suppliers: SupplierConfig[]): Promise<void> {
  const value = JSON.stringify(suppliers);
  exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["suppliers", value]);
  syncSave();
  backupToFile(suppliers);
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
