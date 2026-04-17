import BetterSqlite3 from 'better-sqlite3';
import { DbClient } from '../src/db/client';
import { SCHEMA_SQL } from '../src/db/schema';
import { runSchemaMigrations } from '../src/db/migrations';

export async function createTestClient(): Promise<DbClient> {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');

  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    db.exec(stmt);
  }

  const client: DbClient = {
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = db.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
  };

  // Exercise the migration path even on the canonical schema — catches
  // schema.ts/migrations.ts drift and keeps the test client honest.
  await runSchemaMigrations(client);

  return client;
}

export function createLegacyTestClient(): DbClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE profile (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      sprat_id TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('I', 'II', 'III')),
      cert_expires_on TEXT NOT NULL,
      default_employer TEXT NOT NULL DEFAULT '',
      sprat_card_photo_path TEXT,
      last_backup_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      employer TEXT NOT NULL,
      site TEXT NOT NULL,
      client TEXT NOT NULL,
      description TEXT NOT NULL,
      work_hours REAL NOT NULL,
      tech_level_snapshot TEXT NOT NULL CHECK (tech_level_snapshot IN ('I', 'II', 'III')),
      work_types TEXT NOT NULL DEFAULT '[]',
      equipment_notes TEXT,
      weather TEXT,
      photo_paths TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'amended')),
      amends_entry_id TEXT REFERENCES entries(id),
      amendment_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE signatures (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id),
      supervisor_name TEXT NOT NULL,
      supervisor_cert_number TEXT NOT NULL,
      signature_png_path TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      gps_lat REAL,
      gps_lon REAL,
      entry_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return {
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = db.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
