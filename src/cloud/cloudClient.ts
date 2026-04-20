// src/cloud/cloudClient.ts
import {
  AuthSession,
  SupervisorConnection,
  SignRequest,
  SupervisorSearchKind,
  SupervisorSearchResult,
} from '../types';

export type AuthProvider = 'apple' | 'google';

export interface SignRequestSignInput {
  request_id: string;
  png_bytes: Uint8Array;
  supervisor_name: string;
  supervisor_cert_number: string;
  entry_hash: string;
  hash_version: number;
  signed_device_id: string;
  signed_gps_lat?: number;
  signed_gps_lon?: number;
}

export interface SendSignRequestInput {
  connection_id: string;
  supervisor_user_id: string;
  entry_payload: unknown;           // Entry — serialized as jsonb
  assets_manifest: unknown;         // Record<string, {sha256,size_bytes}>
  asset_uploads: Array<{ key: string; bytes: Uint8Array }>;   // uploaded before the row insert
  expires_at: string;               // ISO, typically now + 30d
}

export interface SupervisorDirectoryUpsert {
  display_name: string;
  sprat_cert_number: string;
  visible: boolean;
}

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

  // Supervisor connections
  listSupervisorConnections(sinceUpdatedAt?: string): Promise<SupervisorConnection[]>;
  inviteSupervisorByEmail(email: string): Promise<SupervisorConnection>;
  inviteSupervisorByUserId(supervisorUserId: string, invitedEmail: string): Promise<SupervisorConnection>;
  respondToConnection(id: string, accept: boolean): Promise<SupervisorConnection>;
  revokeConnection(id: string): Promise<SupervisorConnection>;
  reinviteDeclinedConnection(id: string): Promise<SupervisorConnection>;
  subscribeConnections(callback: (row: SupervisorConnection) => void): () => void;

  // Directory + search
  upsertSupervisorDirectory(entry: SupervisorDirectoryUpsert): Promise<void>;
  deleteSupervisorDirectory(): Promise<void>;
  searchSupervisors(kind: SupervisorSearchKind, query: string): Promise<SupervisorSearchResult[]>;

  // Sign requests
  listSignRequests(sinceUpdatedAt?: string): Promise<SignRequest[]>;
  sendSignRequest(input: SendSignRequestInput): Promise<SignRequest>;
  signRequest(input: SignRequestSignInput): Promise<SignRequest>;
  declineRequest(id: string, reason: string): Promise<SignRequest>;
  withdrawRequest(id: string): Promise<SignRequest>;
  subscribeSignRequests(callback: (row: SignRequest) => void): () => void;
  downloadSignRequestAsset(bucketKey: string): Promise<Uint8Array>;
  cleanupRequestAssets(requestId: string): Promise<void>;

  // Push Notifications
  registerPushToken(token: string): Promise<void>;
  unregisterPushToken(): Promise<void>;
}
