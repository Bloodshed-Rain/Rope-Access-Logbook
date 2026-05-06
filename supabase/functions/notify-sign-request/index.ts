import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface PushMessage {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

serve(async (req) => {
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response('missing_auth', { status: 401 });

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Verify caller
    const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });
    const callerId = userData.user.id;

    // old_record from the client is not trusted for routing — a party can
    // pass any old_record.status to fire spurious push notifications at the
    // counterparty. Routing decisions below depend only on the authoritative
    // row fetched with service-role and on `type`.
    const { type, record } = await req.json();
    if (!record?.id || !type) {
      return new Response(JSON.stringify({ error: 'bad_payload' }), { status: 400 });
    }

    const admin = createClient(url, serviceKey);

    // Verify caller is a party to this sign_request (service-role read so RLS doesn't block us).
    const { data: authoritative, error: fetchErr } = await admin
      .from('sign_requests')
      .select('id, tech_user_id, supervisor_user_id, status')
      .eq('id', record.id)
      .single();
    if (fetchErr || !authoritative) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }
    if (callerId !== authoritative.tech_user_id && callerId !== authoritative.supervisor_user_id) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    }

    // Route the notification based on the transition.
    let recipientId: string | null = null;
    let title = '';
    let body = '';

    // Routing is derived from authoritative.status alone. Each terminal
    // status uniquely identifies which party caused the transition (signed
    // and declined come from the supervisor; withdrawn comes from the tech),
    // so the recipient is the *other* party.
    if (type === 'INSERT' && authoritative.status === 'pending') {
      recipientId = authoritative.supervisor_user_id;
      title = 'New sign request';
      body = 'A technician has sent you a logbook entry to sign.';
    } else if (type === 'UPDATE') {
      if (authoritative.status === 'signed') {
        recipientId = authoritative.tech_user_id;
        title = 'Entry signed';
        body = 'Your supervisor has signed your logbook entry.';
      } else if (authoritative.status === 'declined') {
        recipientId = authoritative.tech_user_id;
        title = 'Request declined';
        body = 'Your supervisor declined your sign request.';
      } else if (authoritative.status === 'withdrawn') {
        recipientId = authoritative.supervisor_user_id;
        title = 'Request withdrawn';
        body = 'A technician withdrew their sign request.';
      }
    }

    if (!recipientId || !title) {
      return new Response(JSON.stringify({ message: 'ignored' }), { status: 200 });
    }

    const { data: tokenData } = await admin
      .from('push_tokens')
      .select('expo_push_token')
      .eq('user_id', recipientId)
      .single();

    if (!tokenData?.expo_push_token) {
      return new Response(JSON.stringify({ message: 'no_token_for_recipient' }), { status: 200 });
    }

    const message: PushMessage = {
      to: tokenData.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { requestId: authoritative.id },
    };

    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const pushData = await pushRes.json();
    return new Response(JSON.stringify({ success: true, pushData }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
