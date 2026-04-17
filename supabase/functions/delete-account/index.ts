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

  // Delete all objects under {uid}/
  const { data: files, error: listErr } = await admin.storage.from('logbook-backups').list(uid, { limit: 1000 });
  if (!listErr && files && files.length > 0) {
    const keys = files.map((f) => `${uid}/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }
  // Also recursively delete subdirs
  const { data: assets } = await admin.storage.from('logbook-backups').list(`${uid}/assets`, { limit: 1000 });
  if (assets && assets.length > 0) {
    const keys = assets.map((f) => `${uid}/assets/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }

  // Delete the Auth user
  const { error: deleteErr } = await admin.auth.admin.deleteUser(uid);
  if (deleteErr) return new Response(`delete_user_failed:${deleteErr.message}`, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
});
