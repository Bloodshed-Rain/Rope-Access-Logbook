// src/cloud/supabaseClient.ts
import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { CloudClient, AuthProvider } from './cloudClient';
import {
  AuthSession as AppAuthSession,
  SupervisorConnection,
  SignRequest,
} from '../types';
import { getConfig } from '../config';
import { generateId } from '../utils/uuid';

WebBrowser.maybeCompleteAuthSession();

const BUCKET = 'logbook-backups';
const SIGN_REQUESTS_BUCKET = 'sign-requests';

function maskCert(cert: string): string {
  if (cert.length <= 4) return cert;
  return cert.slice(0, 2) + '-***' + cert.slice(-2);
}

async function getUid(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('not_authenticated');
  return data.session.user.id;
}

let supabaseSingleton: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (supabaseSingleton) return supabaseSingleton;
  const cfg = getConfig();
  supabaseSingleton = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  return supabaseSingleton;
}

function sessionToAppSession(sbSession: {
  user: { id: string; email: string | null };
  access_token: string;
  refresh_token: string;
  expires_at?: number;
} | null): AppAuthSession | null {
  if (!sbSession) return null;
  return {
    user_id: sbSession.user.id,
    email: sbSession.user.email,
    access_token: sbSession.access_token,
    refresh_token: sbSession.refresh_token,
    expires_at: (sbSession.expires_at ?? 0) * 1000,
  };
}

export function createSupabaseCloudClient(): CloudClient {
  const sb = getSupabase();

  return {
    async uploadObject(key, bytes, contentType = 'application/octet-stream') {
      const { error } = await sb.storage.from(BUCKET).upload(key, bytes, {
        contentType,
        upsert: true,
      });
      if (error) throw error;
    },
    async downloadObject(key) {
      const { data, error } = await sb.storage.from(BUCKET).download(key);
      if (error) throw error;
      if (!data) throw new Error(`empty_response:${key}`);
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    },
    async objectExists(key) {
      const prefix = key.substring(0, key.lastIndexOf('/'));
      const filename = key.substring(key.lastIndexOf('/') + 1);
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { search: filename });
      if (error) return false;
      return (data ?? []).some((f) => f.name === filename);
    },
    async listPrefix(prefix) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (error) throw error;
      return (data ?? []).map((f) => `${prefix}/${f.name}`);
    },
    async deleteObject(key) {
      const { error } = await sb.storage.from(BUCKET).remove([key]);
      if (error) throw error;
    },
    async deletePrefix(prefix) {
      const keys = await this.listPrefix(prefix);
      if (keys.length === 0) return;
      const { error } = await sb.storage.from(BUCKET).remove(keys);
      if (error) throw error;
    },

    async getSession() {
      const { data } = await sb.auth.getSession();
      return sessionToAppSession(data.session as never);
    },
    getCurrentUserId() {
      // Non-async convenience — uses the synchronously-cached session in supabase-js v2.
      // Note: supabase-js v2 removed the synchronous session() method from v1, so this
      // probe will return null at runtime. Callers should prefer the async getSession().
      const session = (sb.auth as unknown as { session?: () => { user?: { id: string } } }).session?.();
      return session?.user?.id ?? null;
    },

    async signInWithProvider(provider: AuthProvider) {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'logbook', path: 'auth-callback' });
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUri, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('oauth_no_url');

      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      if (res.type !== 'success') throw new Error(`oauth_${res.type}`);

      const params = new URL(res.url).searchParams;
      const code = params.get('code');
      if (!code) throw new Error('oauth_no_code');

      const { data: exchData, error: exchErr } = await sb.auth.exchangeCodeForSession(code);
      if (exchErr) throw exchErr;
      const app = sessionToAppSession(exchData.session as never);
      if (!app) throw new Error('oauth_no_session');
      return app;
    },

    async signInWithMagicLink(email) {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'logbook', path: 'auth-callback' });
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectUri },
      });
      if (error) throw error;
    },

    async signOut() {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    },

    async callEdgeFunction<T>(name: string, body?: unknown): Promise<T> {
      const { data, error } = await sb.functions.invoke<T>(name, {
        body: body as Record<string, unknown> | undefined,
      });
      if (error) throw error;
      return data as T;
    },

    onAuthStateChange(callback) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        callback(sessionToAppSession(session as never));
      });
      return () => data.subscription.unsubscribe();
    },

    async isOnline() {
      try {
        const cfg = getConfig();
        const res = await fetch(`${cfg.supabaseUrl}/auth/v1/health`, { method: 'GET' });
        return res.ok;
      } catch {
        return false;
      }
    },

    // --- Supervisor connections ---
    async listSupervisorConnections(sinceUpdatedAt) {
      // RLS filters server-side to (tech_user_id = uid OR supervisor_user_id = uid).
      let q = sb.from('supervisor_connections').select('*');
      if (sinceUpdatedAt) q = q.gt('updated_at', sinceUpdatedAt);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as SupervisorConnection[];
    },

    async inviteSupervisorByEmail(email) {
      const uid = await getUid(sb);
      const { data, error } = await sb
        .from('supervisor_connections')
        .insert({
          tech_user_id: uid,
          supervisor_user_id: null,
          invited_email: email.toLowerCase(),
          status: 'pending',
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      // TODO(part-b): invoke 'invite-supervisor' Edge Function to send the actual
      // invitation email via auth.admin.inviteUserByEmail. For now the signup
      // trigger (resolve_supervisor_invites_on_signup) backfills supervisor_user_id
      // when the invited email signs up.
      return data as SupervisorConnection;
    },

    async inviteSupervisorByUserId(supervisorUserId, invitedEmail) {
      const uid = await getUid(sb);
      if (supervisorUserId === uid) throw new Error('cannot_invite_self');
      const { data, error } = await sb
        .from('supervisor_connections')
        .insert({
          tech_user_id: uid,
          supervisor_user_id: supervisorUserId,
          invited_email: (invitedEmail || '').toLowerCase(),
          status: 'pending',
        })
        .select('*')
        .single();
      if (error) {
        // For a fresh INSERT against an existing (tech, supervisor) row — e.g.
        // previously declined — the uniq_conn_tech_sup index rejects it. Callers
        // should resolve via reinviteDeclinedConnection on the existing row.
        throw new Error(error.message);
      }
      return data as SupervisorConnection;
    },

    async respondToConnection(id, accept) {
      const uid = await getUid(sb);
      let displayName: string | null = null;
      if (accept) {
        const { data: dir } = await sb
          .from('supervisor_directory')
          .select('display_name')
          .eq('user_id', uid)
          .maybeSingle();
        displayName = (dir as { display_name?: string } | null)?.display_name ?? null;
      }
      const update: Record<string, unknown> = {
        status: accept ? 'accepted' : 'declined',
      };
      if (accept && displayName) update.supervisor_display_name = displayName;
      if (!accept) update.declined_at = new Date().toISOString();
      const { data, error } = await sb
        .from('supervisor_connections')
        .update(update)
        .eq('id', id)
        .eq('status', 'pending') // race guard
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as SupervisorConnection;
    },

    async revokeConnection(id) {
      const { data, error } = await sb
        .from('supervisor_connections')
        .update({ status: 'revoked' })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as SupervisorConnection;
    },

    async reinviteDeclinedConnection(id) {
      const { data, error } = await sb
        .from('supervisor_connections')
        .update({ status: 'pending', declined_at: null })
        .eq('id', id)
        .eq('status', 'declined')
        .select('*')
        .single();
      if (error) {
        // enforce_reinvite_cooldown trigger raises 'cooldown_active' when
        // declined_at is within 30 days.
        if (error.message.includes('cooldown_active')) throw new Error('cooldown_active');
        throw new Error(error.message);
      }
      return data as SupervisorConnection;
    },

    subscribeConnections(callback) {
      // Unfiltered subscription — RLS prevents the server from broadcasting rows
      // the client can't read.
      const channel = sb
        .channel('sup_connections_' + Date.now())
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'supervisor_connections' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const row = (payload?.new ?? payload?.old) as SupervisorConnection | undefined;
            if (row) callback(row);
          },
        )
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    // --- Directory + search ---
    async upsertSupervisorDirectory(entry) {
      const uid = await getUid(sb);
      const { error } = await sb.from('supervisor_directory').upsert({
        user_id: uid,
        display_name: entry.display_name,
        sprat_cert_number: entry.sprat_cert_number,
        visible: entry.visible,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },

    async deleteSupervisorDirectory() {
      const uid = await getUid(sb);
      const { error } = await sb.from('supervisor_directory').delete().eq('user_id', uid);
      if (error) throw new Error(error.message);
    },

    async searchSupervisors(kind, query) {
      const uid = await getUid(sb);
      const q = query.trim();
      if (kind === 'sprat_id') {
        const { data, error } = await sb
          .from('supervisor_directory')
          .select('*')
          .eq('visible', true)
          .eq('sprat_cert_number', q)
          .neq('user_id', uid)
          .limit(10);
        if (error) throw new Error(error.message);
        return (data ?? []).map((d) => ({
          user_id: d.user_id,
          display_name: d.display_name,
          sprat_cert_number: d.sprat_cert_number,
          sprat_cert_number_is_masked: false,
        }));
      }
      if (kind === 'name') {
        if (q.length < 3) return [];
        const { data, error } = await sb
          .from('supervisor_directory')
          .select('*')
          .eq('visible', true)
          .ilike('display_name', `${q}%`)
          .neq('user_id', uid)
          .limit(10);
        if (error) throw new Error(error.message);
        return (data ?? []).map((d) => ({
          user_id: d.user_id,
          display_name: d.display_name,
          sprat_cert_number: maskCert(d.sprat_cert_number),
          sprat_cert_number_is_masked: true,
        }));
      }
      // 'email' search: not supported in directory (invite flow goes via
      // inviteSupervisorByEmail). Matches the mock.
      return [];
    },

    // --- Sign requests ---
    async listSignRequests(sinceUpdatedAt) {
      let q = sb.from('sign_requests').select('*');
      if (sinceUpdatedAt) q = q.gt('updated_at', sinceUpdatedAt);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as SignRequest[];
    },

    async sendSignRequest(input) {
      // CRITICAL ORDERING (see Task 34 notes): Storage RLS on the sign-requests
      // bucket joins against sign_requests.id, so the row MUST exist before any
      // asset upload. We generate the UUID client-side so we can rewrite the
      // placeholder keys (sign-requests/PENDING/...) to final keys
      // (sign-requests/{id}/...) before inserting.
      const uid = await getUid(sb);
      const requestId = generateId();

      const rewriteKey = (k: string) =>
        k.replace('sign-requests/PENDING/', `sign-requests/${requestId}/`);

      const manifest: Record<string, { sha256: string; size_bytes: number }> = {};
      for (const [k, v] of Object.entries(
        input.assets_manifest as Record<string, { sha256: string; size_bytes: number }>,
      )) {
        manifest[rewriteKey(k)] = v;
      }

      // 1) Insert the row first with final manifest keys.
      const { data: inserted, error: insertErr } = await sb
        .from('sign_requests')
        .insert({
          id: requestId,
          tech_user_id: uid,
          supervisor_user_id: input.supervisor_user_id,
          connection_id: input.connection_id,
          entry_payload: input.entry_payload,
          assets_manifest: manifest,
          status: 'pending',
          expires_at: input.expires_at,
        })
        .select('*')
        .single();
      if (insertErr) throw new Error(insertErr.message);

      // 2) Upload assets to Storage. Bucket-relative paths only.
      for (const upload of input.asset_uploads) {
        const finalKey = rewriteKey(upload.key);
        const pathInBucket = finalKey.replace(/^sign-requests\//, '');
        const ext = pathInBucket.split('.').pop()?.toLowerCase();
        const contentType =
          ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : 'application/octet-stream';
        const { error: upErr } = await sb.storage
          .from(SIGN_REQUESTS_BUCKET)
          .upload(pathInBucket, upload.bytes, { contentType, upsert: true });
        if (upErr) throw new Error(`upload_failed:${pathInBucket}:${upErr.message}`);
      }

      return inserted as SignRequest;
    },

    async signRequest(input) {
      // On the supervisor side the row already exists (tech inserted it) and
      // supervisor_user_id = auth.uid() — storage RLS for sig.png lines up
      // naturally, so the upload-first order used here is safe.
      const pngPath = `${input.request_id}/sig.png`;
      const { error: upErr } = await sb.storage
        .from(SIGN_REQUESTS_BUCKET)
        .upload(pngPath, input.png_bytes, { contentType: 'image/png', upsert: true });
      if (upErr) throw new Error(`sig_upload_failed:${upErr.message}`);

      const { data, error } = await sb
        .from('sign_requests')
        .update({
          status: 'signed',
          signature_png_path: `${SIGN_REQUESTS_BUCKET}/${pngPath}`,
          supervisor_name_snapshot: input.supervisor_name,
          supervisor_cert_number_snapshot: input.supervisor_cert_number,
          entry_hash: input.entry_hash,
          hash_version: input.hash_version,
          signed_device_id: input.signed_device_id,
          signed_gps_lat: input.signed_gps_lat ?? null,
          signed_gps_lon: input.signed_gps_lon ?? null,
          signed_at: new Date().toISOString(),
        })
        .eq('id', input.request_id)
        .eq('status', 'pending')
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as SignRequest;
    },

    async declineRequest(id, reason) {
      const { data, error } = await sb
        .from('sign_requests')
        .update({ status: 'declined', decline_reason: reason })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as SignRequest;
    },

    async withdrawRequest(id) {
      const { data, error } = await sb
        .from('sign_requests')
        .update({ status: 'withdrawn' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as SignRequest;
    },

    subscribeSignRequests(callback) {
      const channel = sb
        .channel('sign_requests_' + Date.now())
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'sign_requests' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const row = (payload?.new ?? payload?.old) as SignRequest | undefined;
            if (row) callback(row);
          },
        )
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    async downloadSignRequestAsset(bucketKey) {
      const { data, error } = await sb.storage.from(SIGN_REQUESTS_BUCKET).download(bucketKey);
      if (error) throw new Error(error.message);
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}
