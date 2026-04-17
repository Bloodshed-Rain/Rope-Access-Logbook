// src/types.ts

export type SpratLevel = 'I' | 'II' | 'III';

export type EntryStatus = 'draft' | 'signed' | 'amended';

export type WorkType =
  | 'inspection'
  | 'ndt'
  | 'welding'
  | 'painting'
  | 'window_cleaning'
  | 'rescue'
  | 'training'
  | 'rigging'
  | 'other';

export interface Profile {
  id: string;
  full_name: string;
  sprat_id: string;
  level: SpratLevel;
  cert_expires_on: string;
  default_employer: string;
  sprat_card_photo_path: string | null;
  last_backup_at: string | null;
  photos_in_backup: boolean;
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: string;
  date: string;
  employer: string;
  site: string;
  client: string;
  description: string;
  work_hours: number;
  tech_level_snapshot: SpratLevel;
  work_types: WorkType[];
  equipment_notes: string | null;
  weather: string | null;
  photo_paths: string[];
  status: EntryStatus;
  amends_entry_id: string | null;
  amendment_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryRow {
  id: string;
  date: string;
  employer: string;
  site: string;
  client: string;
  description: string;
  work_hours: number;
  tech_level_snapshot: SpratLevel;
  work_types: string;
  equipment_notes: string | null;
  weather: string | null;
  photo_paths: string;
  status: EntryStatus;
  amends_entry_id: string | null;
  amendment_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Signature {
  id: string;
  entry_id: string;
  supervisor_name: string;
  supervisor_cert_number: string;
  signature_png_path: string;
  signed_at: string;
  device_id: string;
  gps_lat: number | null;
  gps_lon: number | null;
  entry_hash: string;
  hash_version: number;
  created_at: string;
}

export interface CreateEntryInput {
  date: string;
  employer: string;
  site: string;
  client: string;
  description: string;
  work_hours: number;
  work_types: WorkType[];
  equipment_notes?: string;
  weather?: string;
  photo_paths?: string[];
  amends_entry_id?: string;
  amendment_reason?: string;
}

export interface UpdateEntryInput {
  date?: string;
  employer?: string;
  site?: string;
  client?: string;
  description?: string;
  work_hours?: number;
  work_types?: WorkType[];
  equipment_notes?: string | null;
  weather?: string | null;
  photo_paths?: string[];
  amendment_reason?: string | null;
}

export interface CreateSignatureInput {
  entry_id: string;
  supervisor_name: string;
  supervisor_cert_number: string;
  signature_png_path: string;
  device_id: string;
  gps_lat?: number;
  gps_lon?: number;
}

export interface CreateProfileInput {
  full_name: string;
  sprat_id: string;
  level: SpratLevel;
  cert_expires_on: string;
  default_employer: string;
  sprat_card_photo_path?: string;
}

export interface UpdateProfileInput {
  full_name?: string;
  sprat_id?: string;
  level?: SpratLevel;
  cert_expires_on?: string;
  default_employer?: string;
  sprat_card_photo_path?: string | null;
}

export interface JsonBackup {
  app_version: string;
  exported_at: string;
  profile: Profile;
  entries: Entry[];
  signatures: Signature[];
  schema_version: number;
}

export interface BinaryManifestEntry {
  sha256: string;
  size_bytes: number;
  created_at: string;
}

export interface BinaryManifest {
  [storage_key: string]: BinaryManifestEntry;
}

export interface CloudSnapshot extends JsonBackup {
  cloud_schema_version: 1;
  backup_id: string;
  binary_manifest: BinaryManifest;
  photos_included: boolean;
}

export interface AuthSession {
  user_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface BackupStatus {
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
  is_uploading: boolean;
  last_error: string | null;
}

export type BackupResult =
  | { kind: 'uploaded'; backup_id: string; bytes_uploaded: number }
  | { kind: 'throttled' }
  | { kind: 'skipped_no_auth' }
  | { kind: 'skipped_offline' }
  | { kind: 'failed'; reason: 'quota' | 'auth_expired' | 'asset_failed' | 'network' | 'unknown'; message: string };

export interface CloudStatePreview {
  has_cloud_data: boolean;
  entries_count: number;
  signatures_count: number;
  cloud_backed_up_at: string | null;
  backup_id: string | null;
}

export type ConflictChoice = 'keep_cloud' | 'replace_cloud';

export type HashFn = (input: string) => Promise<string>;
export type UuidFn = () => string;
