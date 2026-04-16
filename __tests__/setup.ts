// __tests__/setup.ts
import BetterSqlite3 from 'better-sqlite3';
import { DbClient } from '../src/db/client';
import { SCHEMA_SQL } from '../src/db/schema';

export function createTestClient(): DbClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');

  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    db.exec(stmt);
  }

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
