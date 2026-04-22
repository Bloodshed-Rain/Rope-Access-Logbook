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
