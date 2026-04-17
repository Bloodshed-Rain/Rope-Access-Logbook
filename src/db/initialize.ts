// src/db/initialize.ts
import * as SQLite from 'expo-sqlite';
import { createExpoClient } from './expoClient';
import { DbClient } from './client';
import { SCHEMA_SQL } from './schema';
import { runSchemaMigrations } from './migrations';
import { runHashMigration } from './hashMigration';
import { sha256 } from '../utils/hash';

let clientInstance: DbClient | null = null;

export async function initializeDatabase(): Promise<DbClient> {
  if (clientInstance) return clientInstance;
  const db = await SQLite.openDatabaseAsync('logbook.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');

  // Execute each statement individually — execAsync can be
  // unreliable with multiple statements on some devices
  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execAsync(stmt + ';');
  }

  clientInstance = createExpoClient(db);
  await runSchemaMigrations(clientInstance);
  await runHashMigration(clientInstance, sha256);
  return clientInstance;
}

export function setClientForTesting(client: DbClient): void {
  clientInstance = client;
}

export function getClient(): DbClient {
  if (!clientInstance) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return clientInstance;
}
