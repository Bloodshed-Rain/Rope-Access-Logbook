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

  // getUserByEmail is O(1) and avoids loading all users into memory.
  const { data: existingUserData } = await admin.auth.admin.getUserByEmail(email.toLowerCase());
  const alreadyRegistered = !!existingUserData?.user;
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
