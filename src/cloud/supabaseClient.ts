// src/cloud/supabaseClient.ts
import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { CloudClient, AuthProvider } from './cloudClient';
import { AuthSession as AppAuthSession } from '../types';
import { getConfig } from '../config';

WebBrowser.maybeCompleteAuthSession();

const BUCKET = 'logbook-backups';

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

    // --- Supervisor accounts (stubbed; real impl in Task 34) ---
    async listSupervisorConnections() { throw new Error('not_implemented'); },
    async inviteSupervisorByEmail() { throw new Error('not_implemented'); },
    async inviteSupervisorByUserId() { throw new Error('not_implemented'); },
    async respondToConnection() { throw new Error('not_implemented'); },
    async revokeConnection() { throw new Error('not_implemented'); },
    async reinviteDeclinedConnection() { throw new Error('not_implemented'); },
    subscribeConnections() { return () => {}; },
    async upsertSupervisorDirectory() { throw new Error('not_implemented'); },
    async deleteSupervisorDirectory() { throw new Error('not_implemented'); },
    async searchSupervisors() { throw new Error('not_implemented'); },
    async listSignRequests() { throw new Error('not_implemented'); },
    async sendSignRequest() { throw new Error('not_implemented'); },
    async signRequest() { throw new Error('not_implemented'); },
    async declineRequest() { throw new Error('not_implemented'); },
    async withdrawRequest() { throw new Error('not_implemented'); },
    subscribeSignRequests() { return () => {}; },
  };
}
