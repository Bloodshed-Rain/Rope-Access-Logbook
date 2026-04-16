// src/db/client.ts
export interface DbClient {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T>(sql: string, params?: unknown[]): Promise<T | null>;
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}
