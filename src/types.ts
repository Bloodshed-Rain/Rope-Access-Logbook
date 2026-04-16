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

export type HashFn = (input: string) => Promise<string>;
export type UuidFn = () => string;
