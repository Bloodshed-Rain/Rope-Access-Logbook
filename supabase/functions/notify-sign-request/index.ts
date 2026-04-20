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
    const { type, record, old_record } = await req.json();

    // Verify token or simple secret if called from trigger, 
    // but in this case it's a trusted internal webhook or pg_net call.

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    let recipientId: string | null = null;
    let title = '';
    let body = '';

    if (type === 'INSERT' && record.status === 'pending') {
      // Tech sent a request to the supervisor
      recipientId = record.supervisor_user_id;
      title = 'New Sign Request';
      body = 'A technician has sent you a new logbook entry to sign.';
    } else if (type === 'UPDATE' && record.status !== old_record?.status) {
      // Supervisor signed, declined, or tech withdrawn
      if (record.status === 'signed') {
        recipientId = record.tech_user_id;
        title = 'Entry Signed';
        body = 'Your supervisor has signed your logbook entry.';
      } else if (record.status === 'declined') {
        recipientId = record.tech_user_id;
        title = 'Request Declined';
        body = 'Your supervisor declined your sign request.';
      } else if (record.status === 'withdrawn') {
        recipientId = record.supervisor_user_id;
        title = 'Request Withdrawn';
        body = 'A technician withdrew their sign request.';
      }
    }

    if (!recipientId || !title) {
      return new Response(JSON.stringify({ message: 'Ignored' }), { status: 200 });
    }

    // Lookup push token
    const { data: tokenData } = await admin
      .from('push_tokens')
      .select('expo_push_token')
      .eq('user_id', recipientId)
      .single();

    if (!tokenData?.expo_push_token) {
      return new Response(JSON.stringify({ message: 'No token found for recipient' }), { status: 200 });
    }

    const message: PushMessage = {
      to: tokenData.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { requestId: record.id },
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
