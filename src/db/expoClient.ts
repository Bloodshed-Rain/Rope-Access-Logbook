// src/db/expoClient.ts
import * as SQLite from 'expo-sqlite';
import { DbClient } from './client';

export function createExpoClient(db: SQLite.SQLiteDatabase): DbClient {
  return {
    async run(sql, params = []) {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = await db.getFirstAsync<T>(sql, params);
      return row ?? null;
    },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.getAllAsync<T>(sql, params);
    },
    async exec(sql) {
      await db.execAsync(sql);
    },
  };
}
