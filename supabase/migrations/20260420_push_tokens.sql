-- 20260420_push_tokens.sql

CREATE TABLE IF NOT EXISTS push_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can upsert their own push token"
  ON push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger to notify Edge Function
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_sign_request_trigger()
RETURNS TRIGGER AS $$
DECLARE
  url TEXT;
  body JSONB;
BEGIN
  url := current_setting('app.settings.edge_function_url', true) || '/notify-sign-request';
  IF url IS NULL OR url = '/notify-sign-request' THEN
    url := 'http://host.docker.internal:54321/functions/v1/notify-sign-request';
  END IF;

  body := jsonb_build_object(
    'type', TG_OP,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  PERFORM net.http_post(
    url := url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := body
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER sign_requests_notify_trigger
AFTER INSERT OR UPDATE OF status ON sign_requests
FOR EACH ROW
EXECUTE FUNCTION notify_sign_request_trigger();
