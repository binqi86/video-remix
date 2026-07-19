import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import fs from "fs";
import path from "path";
import { getDataPath } from "./getPath";

let SQL: any = null;
let _db: SqlJsDatabase | null = null;
let saveTimer: any = null;

const DB_PATH = getDataPath("db.sqlite");

async function ensureDb(): Promise<SqlJsDatabase> {
  if (!_db) {
    SQL = await initSqlJs();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      _db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
      _db = new SQL.Database();
    }
    _db.run("PRAGMA journal_mode=WAL");
    _db.run("PRAGMA foreign_keys=ON");
  }
  return _db;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  // Write immediately instead of debouncing, so data survives process kills
  if (_db) {
    fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
  }
}

// ------- Public API -------

export async function initDatabase(): Promise<void> {
  await ensureDb();
}

export function queryAll(sql: string, params?: any[]): any[] {
  const d = _db!;
  if (!d) throw new Error("DB not initialized. Call initDatabase() first.");
  const stmt = d.prepare(sql);
  if (params) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryFirst(sql: string, params?: any[]): any | null {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function exec(sql: string, params?: any[]): void {
  const d = _db!;
  if (!d) throw new Error("DB not initialized. Call initDatabase() first.");
  try {
    if (params && params.length > 0) {
      d.run(sql, params);
    } else {
      d.run(sql);
    }
    scheduleSave();
  } catch (err) {
    console.error("[DB Error]", sql.slice(0, 100), err);
    throw err;
  }
}

export function closeDb(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  if (_db) {
    fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
    _db.close();
    _db = null;
  }
  return Promise.resolve();
}

/** Immediately flush the in-memory database to disk. Call this after critical writes. */
export function syncSave(): void {
  if (_db) {
    fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
  }
}

// ------- QueryBuilder (knex-like chainable API) -------

class QueryBuilder {
  private _table: string;
  private _whereClauses: string[] = [];
  private _whereParams: any[] = [];
  private _orderBys: string[] = [];
  private _limitVal: number | null = null;
  private _selectCols: string = "*";

  constructor(table: string) { this._table = table; }

  where(key: string, value: any): this {
    this._whereClauses.push(`${key} = ?`);
    this._whereParams.push(value);
    return this;
  }

  orderBy(col: string, dir: "asc" | "desc" = "asc"): this {
    this._orderBys.push(`${col} ${dir}`);
    return this;
  }

  limit(n: number): this {
    this._limitVal = n;
    return this;
  }

  select(cols: string = "*"): this {
    this._selectCols = cols;
    return this;
  }

  async all(): Promise<any[]> {
    let sql = `SELECT ${this._selectCols} FROM ${this._table}`;
    if (this._whereClauses.length > 0) sql += " WHERE " + this._whereClauses.join(" AND ");
    if (this._orderBys.length > 0) sql += " ORDER BY " + this._orderBys.join(", ");
    if (this._limitVal !== null) sql += ` LIMIT ${this._limitVal}`;
    return queryAll(sql, this._whereParams);
  }

  async first(): Promise<any> {
    let sql = `SELECT ${this._selectCols} FROM ${this._table}`;
    if (this._whereClauses.length > 0) sql += " WHERE " + this._whereClauses.join(" AND ");
    if (this._orderBys.length > 0) sql += " ORDER BY " + this._orderBys.join(", ");
    sql += " LIMIT 1";
    return queryFirst(sql, this._whereParams);
  }

  async insert(data: any): Promise<number> {
    const keys = Object.keys(data);
    const values = keys.map((k) => data[k]);
    const ph = keys.map(() => "?").join(",");
    exec(`INSERT INTO ${this._table} (${keys.join(",")}) VALUES (${ph})`, values);
    const r = queryFirst("SELECT last_insert_rowid() as id");
    return r?.id || Date.now();
  }

  async update(data: any): Promise<number> {
    const keys = Object.keys(data);
    const values = keys.map((k) => data[k]);
    const setStr = keys.map((k) => `${k} = ?`).join(",");
    let sql = `UPDATE ${this._table} SET ${setStr}`;
    if (this._whereClauses.length > 0) sql += " WHERE " + this._whereClauses.join(" AND ");
    exec(sql, [...values, ...this._whereParams]);
    return _db?.getRowsModified() || 0;
  }

  async del(): Promise<number> {
    let sql = `DELETE FROM ${this._table}`;
    if (this._whereClauses.length > 0) sql += " WHERE " + this._whereClauses.join(" AND ");
    exec(sql, this._whereParams);
    return _db?.getRowsModified() || 0;
  }

  async count(col: string = "*"): Promise<any> {
    const rows = await this.all();
    return { count: rows.length };
  }
}

export function db(table: string): QueryBuilder {
  return new QueryBuilder(table);
}
