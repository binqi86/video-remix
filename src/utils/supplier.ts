import { exec, db } from "./db";

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

export async function getSuppliers(): Promise<SupplierConfig[]> {
  try {
    const row = await db("o_setting").where("key", "suppliers").first();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      cachedSuppliers = parsed;
      return parsed;
    }
  } catch {}
  if (!cachedSuppliers) cachedSuppliers = [];
  return cachedSuppliers;
}

export async function saveSuppliers(suppliers: SupplierConfig[]): Promise<void> {
  const value = JSON.stringify(suppliers);
  exec("INSERT OR REPLACE INTO o_setting (key, value) VALUES (?, ?)", ["suppliers", value]);
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
