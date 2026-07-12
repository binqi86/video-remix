import { exec, db, initDatabase } from "../utils/db";

export async function initDB(): Promise<void> {
  // Ensure database is initialized
  await initDatabase();
  const tables = [
    `CREATE TABLE IF NOT EXISTS o_project (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      videoFileName TEXT,
      videoDuration REAL,
      videoWidth INTEGER,
      videoHeight INTEGER,
      videoFps REAL,
      videoFilePath TEXT,
      textModel TEXT DEFAULT '',
      imageModel TEXT DEFAULT '',
      videoModel TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      createTime INTEGER NOT NULL,
      updateTime INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS o_segment (
      id INTEGER PRIMARY KEY,
      projectId INTEGER NOT NULL,
      startTime REAL NOT NULL,
      endTime REAL NOT NULL,
      duration REAL NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      prompt TEXT DEFAULT '',
      characterViewPath TEXT,
      referenceFramePath TEXT,
      imageGenState TEXT DEFAULT 'pending',
      imageGenPath TEXT,
      videoGenState TEXT DEFAULT 'pending',
      videoGenPath TEXT,
      errorReason TEXT,
      createTime INTEGER NOT NULL,
      updateTime INTEGER,
      FOREIGN KEY (projectId) REFERENCES o_project(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS o_tasks (
      id INTEGER PRIMARY KEY,
      projectId INTEGER,
      segmentId INTEGER,
      taskClass TEXT NOT NULL,
      model TEXT,
      describe TEXT,
      relatedObjects TEXT,
      state TEXT DEFAULT '进行中',
      startTime INTEGER NOT NULL,
      reason TEXT,
      createTime INTEGER,
      FOREIGN KEY (projectId) REFERENCES o_project(id),
      FOREIGN KEY (segmentId) REFERENCES o_segment(id)
    )`,
    `CREATE TABLE IF NOT EXISTS o_vendorConfig (
      id TEXT PRIMARY KEY,
      inputValues TEXT DEFAULT '{}',
      models TEXT DEFAULT '[]',
      enable INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS o_asset (
      id INTEGER PRIMARY KEY,
      projectId INTEGER NOT NULL,
      segmentId INTEGER,
      type TEXT NOT NULL,
      fileName TEXT,
      filePath TEXT,
      mimeType TEXT,
      fileSize INTEGER,
      state TEXT DEFAULT 'completed',
      createTime INTEGER NOT NULL,
      FOREIGN KEY (projectId) REFERENCES o_project(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS o_setting (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
  ];

  for (const sql of tables) {
    exec(sql);
  }

  // Seed default settings if not exist
  const settingCount = await db("o_setting").count("key");
  if (settingCount && (settingCount as any).count === 0) {
    await db("o_setting").insert({ key: "defaultTextModel", value: "" });
    await db("o_setting").insert({ key: "defaultImageModel", value: "" });
    await db("o_setting").insert({ key: "defaultVideoModel", value: "" });
  }

  // Seed default vendor config template
  const vendorCount = await db("o_vendorConfig").count("id");
  if (vendorCount && (vendorCount as any).count === 0) {
    await db("o_vendorConfig").insert({
      id: "seedance",
      inputValues: JSON.stringify({ apiKey: "", baseUrl: "https://api.seedance.ai/v1" }),
      models: JSON.stringify([{ name: "seedance-2.0", type: "video" }]),
      enable: 0,
    });
    await db("o_vendorConfig").insert({
      id: "openai",
      inputValues: JSON.stringify({ apiKey: "", baseUrl: "https://api.openai.com/v1" }),
      models: JSON.stringify([{ name: "gpt-4o", type: "text" }, { name: "dall-e-3", type: "image" }]),
      enable: 0,
    });
  }

  console.log("[DB]初始化完成");
}
