// src/types.ts

export type SpratLevel = 'I' | 'II' | 'III';
// CertLevel is the scheme-agnostic alias. SpratLevel kept for backwards compat
// with the many call sites that read profile.level as a SPRAT level today.
export type CertLevel = SpratLevel;
export type CertScheme = 'irata' | 'sprat';

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
  // SPRAT block. DB columns sprat_id/level/cert_expires_on are nullable so
  // IRATA-only users are first-class. Types here are non-null because every
  // user reachable from current code paths is a SPRAT holder; the IRATA-only
  // path lands with the cert-selection UI in a later commit, at which point
  // these tighten to nullable across consumers.
  holds_sprat: boolean;
  sprat_id: string;
  level: SpratLevel;
  cert_expires_on: string;
  sprat_card_photo_path: string | null;
  // IRATA block. Nullable from day one (no legacy data to honor).
  holds_irata: boolean;
  irata_id: string | null;
  irata_level: CertLevel | null;
  irata_expires_on: string | null;
  irata_card_photo_path: string | null;
  // Drives the dashboard cert toggle's default segment.
  primary_cert: CertScheme;
  default_employer: string;
  last_backup_at: string | null;
  photos_in_backup: boolean;
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
  supervisor_capability_enabled: boolean;
  supervisor_cert_number: string | null;
  supervisor_directory_visible: boolean;
  subscription_tier: 'free' | 'pro';
  created_at: string;
  updated_at: string;
}

export interface Entry {
  id: string;
  date_from: string;
  date_to: string;
  employer: string;
  site: string;
  client: string;
  description: string;
  work_hours: number;
  // tech_level_snapshot is the SPRAT level at entry creation. Kept under its
  // legacy name to preserve v1/v2/v3 hash compatibility — every signed entry
  // already carries a hash that includes this exact key.
  tech_level_snapshot: SpratLevel;
  // IRATA level at entry creation. Null on legacy entries (pre-dual-cert) and
  // on entries by techs who don't hold IRATA. Deliberately NOT in canonical
  // hash input — adding it would invalidate every existing signature.
  irata_level_snapshot: CertLevel | null;
  work_types: WorkType[];
  other_work_description: string | null;
  equipment_notes: string | null;
  weather: string | null;
  photo_paths: string[];
  status: EntryStatus;
  amends_entry_id: string | null;
  amendment_reason: string | null;
  pending_sign_request_id: string | null;
  created_at: string;
  updated_at: string;
}

// Kept on the DB row type (not on the domain Entry) so existing v1/v2-signed
// entries remain hash-verifiable. New writes populate date = date_from to keep
// the column in sync.
export interface EntryRow {
  id: string;
  date: string;
  date_from: string;
  date_to: string;
  employer: string;
  site: string;
  client: string;
  description: string;
  work_hours: number;
  tech_level_snapshot: SpratLevel;
  irata_level_snapshot: CertLevel | null;
  work_types: string;
  other_work_description: string | null;
  equipment_notes: string | null;
  weather: string | null;
  photo_paths: string;
  status: EntryStatus;
  amends_entry_id: string | null;
  amendment_reason: string | null;
  pending_sign_request_id: string | null;
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
  date_from?: string;
  date_to?: string;
  employer?: string;
  site?: string;
  client?: string;
  description?: string;
  work_hours?: number;
  work_types?: WorkType[];
  other_work_description?: string | null;
  equipment_notes?: string;
  weather?: string;
  photo_paths?: string[];
  amends_entry_id?: string;
  amendment_reason?: string;
}

export interface UpdateEntryInput {
  date_from?: string;
  date_to?: string;
  employer?: string;
  site?: string;
  client?: string;
  description?: string;
  work_hours?: number;
  work_types?: WorkType[];
  other_work_description?: string | null;
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
  // IRATA fields — optional. If holds_irata is set, the rest of the IRATA
  // block must be present.
  holds_irata?: boolean;
  irata_id?: string;
  irata_level?: CertLevel;
  irata_expires_on?: string;
  irata_card_photo_path?: string;
  primary_cert?: CertScheme;
}

export interface UpdateProfileInput {
  full_name?: string;
  sprat_id?: string;
  level?: SpratLevel;
  cert_expires_on?: string;
  default_employer?: string;
  sprat_card_photo_path?: string | null;
  holds_sprat?: boolean;
  holds_irata?: boolean;
  irata_id?: string | null;
  irata_level?: CertLevel | null;
  irata_expires_on?: string | null;
  irata_card_photo_path?: string | null;
  primary_cert?: CertScheme;
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
  cloud_schema_version: 1 | 2;
  backup_id: string;
  binary_manifest: BinaryManifest;
  photos_included: boolean;
}

export interface AuthSession {
  user_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string;
  /** Unix epoch milliseconds. */
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

// --- Supervisor accounts ---

export type SupervisorConnectionStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface SupervisorConnection {
  id: string;
  tech_user_id: string;
  supervisor_user_id: string | null;   // null until email-invited supervisor signs up
  status: SupervisorConnectionStatus;
  invited_email: string;
  supervisor_display_name: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SignRequestStatus = 'pending' | 'signed' | 'declined' | 'withdrawn' | 'expired';

export interface SignRequestAssetManifestEntry {
  sha256: string;
  size_bytes: number;
}

export interface SignRequest {
  id: string;
  tech_user_id: string;
  supervisor_user_id: string;
  connection_id: string;
  entry_payload: Entry;                  // frozen snapshot
  assets_manifest: Record<string, SignRequestAssetManifestEntry>;
  status: SignRequestStatus;
  decline_reason: string | null;
  signature_png_path: string | null;     // storage key, set when signed
  supervisor_name_snapshot: string | null;
  supervisor_cert_number_snapshot: string | null;
  entry_hash: string | null;
  hash_version: number | null;
  signed_device_id: string | null;
  signed_gps_lat: number | null;
  signed_gps_lon: number | null;
  created_at: string;
  expires_at: string;
  signed_at: string | null;
  updated_at: string;
}

export interface SupervisorDirectoryEntry {
  user_id: string;
  display_name: string;
  sprat_cert_number: string;
  visible: boolean;
  updated_at: string;
}

export type SupervisorSearchKind = 'email' | 'sprat_id' | 'name';

export interface SupervisorSearchResult {
  user_id: string;
  display_name: string;
  sprat_cert_number: string;             // masked on name search, full on sprat_id search
  sprat_cert_number_is_masked: boolean;
}

export type HashFn = (input: string) => Promise<string>;
export type UuidFn = () => string;
