// src/db/initialize.ts
import * as SQLite from 'expo-sqlite';
import { createExpoClient } from './expoClient';
import { DbClient } from './client';
import { SCHEMA_SQL } from './schema';

let clientInstance: DbClient | null = null;

export async function initializeDatabase(): Promise<DbClient> {
  if (clientInstance) return clientInstance;
  const db = await SQLite.openDatabaseAsync('logbook.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(SCHEMA_SQL);
  clientInstance = createExpoClient(db);
  return clientInstance;
}

export function setClientForTesting(client: DbClient): void {
  clientInstance = client;
}

export function getClient(): DbClient {
  if (!clientInstance) throw new Error('Database not initialized. Call initializeDatabase() first.');
  return clientInstance;
}
