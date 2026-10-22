// SQLite storage (node:sqlite, no native dependencies).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      serial TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      site TEXT NOT NULL DEFAULT '',
      fw TEXT NOT NULL DEFAULT '0.0.0',
      token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS telemetry (
      device_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      cpu REAL, mem REAL, temp REAL, humidity REAL, power REAL
    );
    CREATE INDEX IF NOT EXISTS telemetry_dev_ts ON telemetry(device_id, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      resolved_at INTEGER,
      acked_by TEXT
    );
    CREATE INDEX IF NOT EXISTS alerts_open ON alerts(device_id, rule, resolved_at);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      device_id TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      signature TEXT NOT NULL,
      content BLOB NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rollouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rollout_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL,          -- pending | delivered | installing | done | failed
      detail TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_dev ON jobs(device_id, status);
  `);
  return db;
}

export function addEvent(db: Db, deviceId: string | null, kind: string, message: string, ts = Date.now()) {
  db.prepare('INSERT INTO events (ts, device_id, kind, message) VALUES (?, ?, ?, ?)').run(ts, deviceId, kind, message);
}
