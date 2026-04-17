// src/cloud/cloudClient.ts
import { AuthSession } from '../types';

export type AuthProvider = 'apple' | 'google';

export interface CloudClient {
  // Storage
  uploadObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  downloadObject(key: string): Promise<Uint8Array>;
  objectExists(key: string): Promise<boolean>;
  listPrefix(prefix: string): Promise<string[]>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;

  // Auth
  getSession(): Promise<AuthSession | null>;
  getCurrentUserId(): string | null;
  signInWithProvider(provider: AuthProvider): Promise<AuthSession>;
  signInWithMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  // Edge Functions
  callEdgeFunction<TResponse>(name: string, body?: unknown): Promise<TResponse>;

  // Observability
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;

  // Connectivity
  isOnline(): Promise<boolean>;
}
