# Supervisor Accounts Part B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete supervisor accounts by adding server-side Edge Functions, pg_cron jobs, delete-account cascade, and two client-side fixes (photo download, form auto-save).

**Architecture:** Three new Supabase Edge Functions (Deno), one new Postgres migration for cron jobs + rate-limit table, extension of the existing `delete-account` function, and targeted edits to `SignRequestDetailScreen` and `EntryFormScreen`. The `CloudClient` interface gets one new method (`cleanupRequestAssets`); `searchSupervisors` switches from direct Postgres to Edge Function.

**Tech Stack:** Supabase Edge Functions (Deno), pg_cron, `@supabase/supabase-js`, React Native, expo-file-system

---

### Task 1: Edge Function — `invite-supervisor`

**Files:**
- Create: `supabase/functions/invite-supervisor/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/invite-supervisor/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('missing_auth', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });

  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_email' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(url, service);

  // Check if user already exists
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const alreadyRegistered = (existingUsers?.users ?? []).some(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (alreadyRegistered) {
    return new Response(JSON.stringify({ error: 'already_registered' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteErr) {
    return new Response(JSON.stringify({ error: inviteErr.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
```

- [ ] **Step 2: Wire up inviteSupervisorByEmail to call the Edge Function**

In `src/cloud/supabaseClient.ts`, update `inviteSupervisorByEmail` (lines 190-208). After inserting the connection row, call the Edge Function:

```typescript
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
      // Send invite email via Edge Function (best-effort — row is already created,
      // the signup trigger will backfill supervisor_user_id when they register).
      try {
        await sb.functions.invoke('invite-supervisor', { body: { email } });
      } catch {
        // Non-fatal: connection row exists, invite email is a convenience.
      }
      return data as SupervisorConnection;
    },
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/invite-supervisor/index.ts src/cloud/supabaseClient.ts
git commit -m "feat(edge): invite-supervisor Edge Function + client wiring"
```

---

### Task 2: Edge Function — `search-supervisors`

**Files:**
- Create: `supabase/functions/search-supervisors/index.ts`
- Modify: `src/cloud/supabaseClient.ts:327-366`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/search-supervisors/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_SEARCHES_PER_DAY = 20;

function maskCert(cert: string): string {
  if (cert.length <= 4) return cert;
  return cert.slice(0, 2) + '-***' + cert.slice(-2);
}

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('missing_auth', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });
  const uid = userData.user.id;

  const { kind, query } = await req.json();
  if (!kind || !query || typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_params' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(url, serviceKey);

  // Cleanup stale rate-limit rows, then count recent searches
  await admin.from('search_rate_limits').delete().lt('searched_at', new Date(Date.now() - 86400_000).toISOString());
  const { count } = await admin
    .from('search_rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', uid);

  if ((count ?? 0) >= MAX_SEARCHES_PER_DAY) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Record this search
  await admin.from('search_rate_limits').insert({ user_id: uid });

  const q = query.trim();
  let results: Array<{ user_id: string; display_name: string; sprat_cert_number: string; sprat_cert_number_is_masked: boolean }> = [];

  if (kind === 'sprat_id') {
    const { data } = await admin
      .from('supervisor_directory')
      .select('user_id, display_name, sprat_cert_number')
      .eq('visible', true)
      .eq('sprat_cert_number', q)
      .neq('user_id', uid)
      .limit(10);
    results = (data ?? []).map((d) => ({
      user_id: d.user_id,
      display_name: d.display_name,
      sprat_cert_number: d.sprat_cert_number,
      sprat_cert_number_is_masked: false,
    }));
  } else if (kind === 'name') {
    if (q.length < 3) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { data } = await admin
      .from('supervisor_directory')
      .select('user_id, display_name, sprat_cert_number')
      .eq('visible', true)
      .ilike('display_name', `${q}%`)
      .neq('user_id', uid)
      .limit(10);
    results = (data ?? []).map((d) => ({
      user_id: d.user_id,
      display_name: d.display_name,
      sprat_cert_number: maskCert(d.sprat_cert_number),
      sprat_cert_number_is_masked: true,
    }));
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
```

- [ ] **Step 2: Update supabaseClient.ts to call Edge Function instead of direct query**

Replace `searchSupervisors` in `src/cloud/supabaseClient.ts` (lines 327-366):

```typescript
    async searchSupervisors(kind, query) {
      const response = await sb.functions.invoke<{ results?: Array<{ user_id: string; display_name: string; sprat_cert_number: string; sprat_cert_number_is_masked: boolean }>; error?: string }>('search-supervisors', {
        body: { kind, query },
      });
      if (response.error) throw new Error(typeof response.error === 'string' ? response.error : response.error.message);
      const data = response.data;
      if (data?.error === 'rate_limited') throw new Error('rate_limited');
      if (data?.error) throw new Error(data.error);
      return data?.results ?? [];
    },
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/search-supervisors/index.ts src/cloud/supabaseClient.ts
git commit -m "feat(edge): search-supervisors Edge Function with rate limiting"
```

---

### Task 3: Add `cleanupRequestAssets` to CloudClient interface and implementations

**Files:**
- Modify: `src/cloud/cloudClient.ts:85` (add method to interface)
- Modify: `src/cloud/supabaseClient.ts` (add implementation)
- Modify: `__tests__/cloudMock.ts` (add no-op mock)

- [ ] **Step 1: Add to CloudClient interface**

In `src/cloud/cloudClient.ts`, add before the closing brace of the `CloudClient` interface (after line 85):

```typescript
  cleanupRequestAssets(requestId: string): Promise<void>;
```

- [ ] **Step 2: Add Supabase implementation**

In `src/cloud/supabaseClient.ts`, add after the `downloadSignRequestAsset` method (after line 512):

```typescript
    async cleanupRequestAssets(requestId) {
      try {
        await sb.functions.invoke('cleanup-request-assets', {
          body: { request_id: requestId },
        });
      } catch {
        // Best-effort: if the Edge Function fails, assets linger until daily cron.
      }
    },
```

- [ ] **Step 3: Add mock implementation**

In `__tests__/cloudMock.ts`, add after the `downloadSignRequestAsset` method (after line 471):

```typescript
    async cleanupRequestAssets(_requestId) {
      // No-op in mock — assets don't need cleanup in tests.
    },
```

- [ ] **Step 4: Commit**

```bash
git add src/cloud/cloudClient.ts src/cloud/supabaseClient.ts __tests__/cloudMock.ts
git commit -m "feat(cloud): add cleanupRequestAssets to CloudClient interface"
```

---

### Task 4: Edge Function — `cleanup-request-assets`

**Files:**
- Create: `supabase/functions/cleanup-request-assets/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/cleanup-request-assets/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TERMINAL = new Set(['signed', 'declined', 'withdrawn', 'expired']);

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('missing_auth', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });
  const uid = userData.user.id;

  const { request_id } = await req.json();
  if (!request_id) {
    return new Response(JSON.stringify({ error: 'missing_request_id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(url, serviceKey);

  const { data: row, error: fetchErr } = await admin
    .from('sign_requests')
    .select('tech_user_id, supervisor_user_id, status')
    .eq('id', request_id)
    .single();

  if (fetchErr || !row) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (uid !== row.tech_user_id && uid !== row.supervisor_user_id) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!TERMINAL.has(row.status)) {
    return new Response(JSON.stringify({ error: 'not_terminal' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // List and delete all assets under {request_id}/
  const { data: files } = await admin.storage
    .from('sign-requests')
    .list(request_id, { limit: 1000 });
  let deletedCount = 0;
  if (files && files.length > 0) {
    const keys = files.map((f) => `${request_id}/${f.name}`);
    await admin.storage.from('sign-requests').remove(keys);
    deletedCount = keys.length;
  }

  return new Response(JSON.stringify({ ok: true, deleted_count: deletedCount }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/cleanup-request-assets/index.ts
git commit -m "feat(edge): cleanup-request-assets Edge Function"
```

---

### Task 5: Wire cleanup calls into signRequestsService

**Files:**
- Modify: `src/services/signRequestsService.ts:114-129` (withdraw, decline, applyIncomingSignature)

- [ ] **Step 1: Add cleanup call after applyIncomingSignature writes the signature**

In `src/services/signRequestsService.ts`, add after the `UPDATE entries` statement in `applyIncomingSignature` (after line 207, before the return on line 209):

```typescript
    try { await cloud.cleanupRequestAssets(row.id); } catch {}
```

- [ ] **Step 2: Add cleanup call after withdraw**

In `src/services/signRequestsService.ts`, add at the end of `withdraw` (after line 122, before `return row;`):

```typescript
    try { await cloud.cleanupRequestAssets(row.id); } catch {}
```

- [ ] **Step 3: Add cleanup call after decline**

In `src/services/signRequestsService.ts`, add at the end of `decline` (after line 128, before `return row;`):

```typescript
    try { await cloud.cleanupRequestAssets(row.id); } catch {}
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `npx jest --runInBand`
Expected: All 132 tests pass (cleanup is a no-op in the mock).

- [ ] **Step 5: Commit**

```bash
git add src/services/signRequestsService.ts
git commit -m "feat(sign-requests): best-effort asset cleanup on terminal states"
```

---

### Task 6: Postgres migration — cron jobs + rate-limit table

**Files:**
- Create: `supabase/migrations/20260419_cron_and_rate_limits.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 20260419_cron_and_rate_limits.sql
-- pg_cron jobs for sign_requests lifecycle + search rate-limit table.

-- Enable pg_cron (available by default on Supabase)
create extension if not exists pg_cron;

-- ============================================================================
-- Rate-limit table for search-supervisors Edge Function
-- ============================================================================
create table if not exists search_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  searched_at timestamptz not null default now()
);

create index if not exists idx_rate_user_time on search_rate_limits (user_id, searched_at);

-- No RLS needed — only the Edge Function (service-role) accesses this table.

-- ============================================================================
-- Cron: hourly expire pending sign requests past their expiry
-- ============================================================================
select cron.schedule('expire-pending-requests', '0 * * * *', $$
  update sign_requests
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();
$$);

-- ============================================================================
-- Cron: daily hard-delete terminal sign requests older than 90 days
-- ============================================================================
select cron.schedule('cleanup-terminal-requests', '0 3 * * *', $$
  delete from sign_requests
  where status in ('signed', 'declined', 'withdrawn', 'expired')
    and updated_at < now() - interval '90 days';
$$);

-- ============================================================================
-- Cron: daily cleanup stale search rate-limit rows
-- ============================================================================
select cron.schedule('cleanup-rate-limits', '0 4 * * *', $$
  delete from search_rate_limits
  where searched_at < now() - interval '24 hours';
$$);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260419_cron_and_rate_limits.sql
git commit -m "feat(db): pg_cron jobs + search rate-limit table"
```

---

### Task 7: Extend `delete-account` Edge Function with supervisor cascade

**Files:**
- Modify: `supabase/functions/delete-account/index.ts`

- [ ] **Step 1: Add supervisor cascade before auth user deletion**

Replace the entire `supabase/functions/delete-account/index.ts`:

```typescript
// supabase/functions/delete-account/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('missing_auth', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify caller JWT
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });
  const uid = userData.user.id;

  // Service-role client for destructive ops
  const admin = createClient(url, service);

  // --- Supervisor cascade (before auth deletion so ON DELETE CASCADE doesn't race) ---

  // 1) Flip in-flight sign requests to terminal states so the other party gets
  //    a clean status via Realtime/sync instead of rows silently vanishing.
  await admin
    .from('sign_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('tech_user_id', uid)
    .eq('status', 'pending');

  await admin
    .from('sign_requests')
    .update({
      status: 'declined',
      decline_reason: 'Supervisor account deleted',
      updated_at: new Date().toISOString(),
    })
    .eq('supervisor_user_id', uid)
    .eq('status', 'pending');

  // 2) Clean up sign-request assets for all requests where user is a party.
  const { data: userRequests } = await admin
    .from('sign_requests')
    .select('id')
    .or(`tech_user_id.eq.${uid},supervisor_user_id.eq.${uid}`);
  if (userRequests) {
    for (const r of userRequests) {
      const { data: files } = await admin.storage
        .from('sign-requests')
        .list(r.id, { limit: 1000 });
      if (files && files.length > 0) {
        const keys = files.map((f: { name: string }) => `${r.id}/${f.name}`);
        await admin.storage.from('sign-requests').remove(keys);
      }
    }
  }

  // 3) Delete supervisor directory entry (ON DELETE CASCADE would also handle it).
  await admin.from('supervisor_directory').delete().eq('user_id', uid);

  // --- Logbook-backups cleanup (existing) ---

  const { data: files, error: listErr } = await admin.storage.from('logbook-backups').list(uid, { limit: 1000 });
  if (!listErr && files && files.length > 0) {
    const keys = files.map((f: { name: string }) => `${uid}/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }
  const { data: assets } = await admin.storage.from('logbook-backups').list(`${uid}/assets`, { limit: 1000 });
  if (assets && assets.length > 0) {
    const keys = assets.map((f: { name: string }) => `${uid}/assets/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }

  // --- Delete the Auth user (cascades supervisor_connections + sign_requests rows) ---

  const { error: deleteErr } = await admin.auth.admin.deleteUser(uid);
  if (deleteErr) return new Response(`delete_user_failed:${deleteErr.message}`, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/delete-account/index.ts
git commit -m "feat(edge): delete-account cascades supervisor data before auth deletion"
```

---

### Task 8: Supervisor-side photo download in `SignRequestDetailScreen`

**Files:**
- Modify: `src/screens/SignRequestDetailScreen.tsx`

- [ ] **Step 1: Add photo download state and effect**

Replace the entire `src/screens/SignRequestDetailScreen.tsx`:

```typescript
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Image, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { Screen, Card, Button, Banner, Input } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSignRequests } from '../hooks/useSignRequests';
import { useProfile } from '../hooks/useProfile';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';
import { SignRequest, Entry } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignRequestDetail'>;

type PhotoState = { status: 'loading' } | { status: 'loaded'; uri: string } | { status: 'failed' };

function useRequestPhotos(req: SignRequest | undefined, cloud: ReturnType<typeof createSupabaseCloudClient>) {
  const [photos, setPhotos] = useState<PhotoState[]>([]);

  useEffect(() => {
    if (!req) return;
    const entry = req.entry_payload as Entry;
    if (entry.photo_paths.length === 0) return;

    const manifest = req.assets_manifest as Record<string, { sha256: string; size_bytes: number }>;
    const photoKeys = Object.keys(manifest).filter((k) => {
      const filename = k.split('/').pop() ?? '';
      return filename.startsWith('photo_');
    });

    if (photoKeys.length === 0) {
      setPhotos(entry.photo_paths.map(() => ({ status: 'failed' as const })));
      return;
    }

    setPhotos(photoKeys.map(() => ({ status: 'loading' as const })));
    let cancelled = false;

    (async () => {
      const results: PhotoState[] = [];
      for (let i = 0; i < photoKeys.length; i++) {
        if (cancelled) return;
        try {
          // Strip the "sign-requests/" prefix to get the bucket-relative key
          const bucketKey = photoKeys[i].replace(/^sign-requests\//, '');
          const bytes = await cloud.downloadSignRequestAsset(bucketKey);
          const ext = bucketKey.split('.').pop() ?? 'jpg';
          const tempPath = `${FileSystem.cacheDirectory}req_photo_${req.id}_${i}.${ext}`;
          // Convert bytes to base64 and write to temp file
          let binary = '';
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
          const base64 = btoa(binary);
          await FileSystem.writeAsStringAsync(tempPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          results.push({ status: 'loaded', uri: tempPath });
        } catch {
          results.push({ status: 'failed' });
        }
      }
      if (!cancelled) setPhotos(results);
    })();

    return () => { cancelled = true; };
  }, [req?.id]);

  return photos;
}

export function SignRequestDetailScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { data: profile } = useProfile();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const [showCanvas, setShowCanvas] = useState(false);
  const [signing, setSigning] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const sigRef = useRef<any>(null);

  const req = (signReqs.query.data ?? []).find((r) => r.id === route.params.requestId);
  const photos = useRequestPhotos(req, cloud);
  if (!req || !profile) return null;
  const entry = req.entry_payload;

  const handleSign = async (png_base64: string) => {
    setSigning(true);
    try {
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {}
      await signReqs.sign.mutateAsync({
        request_id: req.id,
        png_base64: png_base64.replace('data:image/png;base64,', ''),
        supervisor_name: profile.full_name,
        supervisor_cert_number: profile.supervisor_cert_number ?? '',
        device_id: Device.modelName ?? 'unknown',
        gps_lat: lat,
        gps_lon: lon,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not sign', e.message);
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    try {
      await signReqs.decline.mutateAsync({ id: req.id, reason: declineReason.trim() });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not decline', e.message);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, padding: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Sign request</Text>
        <Banner variant="info" message={`Requested at ${new Date(req.created_at).toLocaleString()}`} />

        <Card>
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>
            {entry.date_from === entry.date_to ? entry.date_from : `${entry.date_from} → ${entry.date_to}`}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.site} · {entry.client}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.employer}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.work_hours}h · Level {entry.tech_level_snapshot}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            Work types: {entry.work_types.join(', ')}
          </Text>
          {entry.other_work_description && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Other: {entry.other_work_description}
            </Text>
          )}
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm }]}>
            {entry.description}
          </Text>
          {entry.equipment_notes && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              Equipment: {entry.equipment_notes}
            </Text>
          )}
          {entry.weather && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Weather: {entry.weather}
            </Text>
          )}
        </Card>

        {photos.length > 0 && (
          <Card>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
              Photos
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {photos.map((p, i) => (
                <View key={i} style={{ width: 100, height: 100, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.background }}>
                  {p.status === 'loading' && (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                      <ActivityIndicator />
                    </View>
                  )}
                  {p.status === 'loaded' && (
                    <Image source={{ uri: p.uri }} style={{ width: 100, height: 100 }} />
                  )}
                  {p.status === 'failed' && (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        Photo{'\n'}unavailable
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </Card>
        )}

        {req.status !== 'pending' && (
          <Banner
            variant="info"
            message={`Status: ${req.status}${req.decline_reason ? ` — ${req.decline_reason}` : ''}`}
          />
        )}

        {req.status === 'pending' && !showCanvas && !declineMode && (
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <Button title="Sign" onPress={() => setShowCanvas(true)} />
            <Button title="Decline" variant="ghost" onPress={() => setDeclineMode(true)} />
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
        )}

        {declineMode && (
          <Card>
            <Input
              label="Decline reason"
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Optional reason (the tech will see this)"
              maxLength={200}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={{ minHeight: 100 }}
            />
            <View style={{ height: spacing.xs }} />
            <Button title="Decline request" onPress={handleDecline} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setDeclineMode(false);
                setDeclineReason('');
              }}
            />
          </Card>
        )}

        {showCanvas && (
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Your signature</Text>
            <View style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', height: 200 }}>
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => handleSign(sig)}
                autoClear={false}
                descriptionText=""
                webStyle={`.m-signature-pad{box-shadow:none;border:none}.m-signature-pad--body{border:none}.m-signature-pad--footer{display:none}`}
              />
            </View>
            <Button title="Confirm signature" onPress={() => sigRef.current?.readSignature()} loading={signing} />
            <Button title="Clear" variant="ghost" onPress={() => sigRef.current?.clearSignature()} />
            <Button title="Back" variant="ghost" onPress={() => setShowCanvas(false)} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/screens/SignRequestDetailScreen.tsx
git commit -m "feat(ui): supervisor-side photo download from sign-requests bucket"
```

---

### Task 9: Auto-save on "Send for Signature" in `EntryFormScreen`

**Files:**
- Modify: `src/screens/EntryFormScreen.tsx`

- [ ] **Step 1: Extract `saveEntry` and wire into send flow**

In `src/screens/EntryFormScreen.tsx`, replace `handleSave` (lines 148-185) and the supervisor picker `onPress` (lines 347-358) with:

First, replace the `handleSave` function (lines 148-185):

```typescript
  const saveEntry = async (): Promise<string | null> => {
    if (!profile) return null;
    const hours = workHours.trim() === '' ? 0 : parseFloat(workHours);
    if (workHours.trim() !== '' && (isNaN(hours) || hours < 0)) {
      Alert.alert('Invalid hours', 'Please enter a valid number of work hours.');
      return null;
    }

    const otherText = workTypes.includes('other') && otherWorkDescription.trim()
      ? otherWorkDescription.trim()
      : null;

    if (isAmend && amendId) {
      const result = await createAmendment.mutateAsync({ entryId: amendId, reason: amendmentReason.trim(), techLevel: profile.level });
      return result.id;
    } else if (isEdit && editId) {
      await updateEntry.mutateAsync({
        id: editId,
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || null, weather: weather || null, photo_paths: photoPaths,
        },
      });
      return editId;
    } else {
      const result = await createEntry.mutateAsync({
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || undefined, weather: weather || undefined,
          photo_paths: photoPaths.length > 0 ? photoPaths : undefined,
        },
        techLevel: profile.level,
      });
      return result.id;
    }
  };

  const handleSave = async () => {
    const id = await saveEntry();
    if (id === null) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  };
```

Then replace the supervisor picker `onPress` handler (the `ListRow` onPress inside the `showPicker` block, lines 347-358):

```typescript
                      <ListRow
                        key={c.id}
                        title={c.supervisor_display_name ?? c.invited_email}
                        subtitle="Tap to send"
                        onPress={async () => {
                          try {
                            const savedId = await saveEntry();
                            if (!savedId) return;
                            await signReqs.send.mutateAsync({
                              entry_id: savedId,
                              connection_id: c.id,
                              supervisor_user_id: c.supervisor_user_id!,
                            });
                            setShowPicker(false);
                            navigation.goBack();
                          } catch (e: any) {
                            Alert.alert('Could not send', e.message);
                          }
                        }}
                      />
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/screens/EntryFormScreen.tsx
git commit -m "feat(ui): auto-save entry before sending for signature"
```

---

### Task 10: Update CLAUDE.md and run final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run all tests**

Run: `npx jest --runInBand`
Expected: All tests pass (132+)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Update CLAUDE.md "Not yet implemented" section**

Remove the completed items from the "Not yet implemented" list:
- Remove: "Edge Functions: `invite-supervisor`..."
- Remove: "`pg_cron` jobs..."
- Remove: "`delete-account` Edge Function cascade..."
- Remove: "Supervisor-side photo download..."
- Remove: "Form auto-save before 'Send for signature'..."

The "Not yet implemented" section for supervisor accounts Part B should now only reference anything genuinely still pending (if any).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md reflects Part B completion"
```

- [ ] **Step 5: Push**

```bash
git push
```
