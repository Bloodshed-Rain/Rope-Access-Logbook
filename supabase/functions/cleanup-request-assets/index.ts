import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  if (!request_id || typeof request_id !== 'string') {
    return new Response(JSON.stringify({ error: 'missing_request_id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const admin = createClient(url, serviceKey);

  // Fetch the sign_requests row
  const { data: reqRow, error: fetchErr } = await admin
    .from('sign_requests')
    .select('id, tech_user_id, supervisor_user_id, status')
    .eq('id', request_id)
    .single();

  if (fetchErr || !reqRow) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Verify caller is a party and status is terminal
  const isParty = uid === reqRow.tech_user_id || uid === reqRow.supervisor_user_id;
  const isTerminal = ['signed', 'declined', 'withdrawn', 'expired'].includes(reqRow.status);
  if (!isParty || !isTerminal) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  // List all objects under sign-requests/{request_id}/
  const { data: files, error: listErr } = await admin.storage
    .from('sign-requests')
    .list(request_id, { limit: 1000 });

  let deletedCount = 0;
  if (!listErr && files && files.length > 0) {
    const keys = files.map((f) => `${request_id}/${f.name}`);
    await admin.storage.from('sign-requests').remove(keys);
    deletedCount = keys.length;
  }

  return new Response(JSON.stringify({ ok: true, deleted_count: deletedCount }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
