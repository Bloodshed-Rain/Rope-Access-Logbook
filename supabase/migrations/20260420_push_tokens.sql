-- 20260420_push_tokens.sql
-- Stores each user's Expo push token. Notifications are dispatched from the
-- app itself (signRequestsService calls cloud.notifySignRequest after each
-- sign_requests mutation), so no DB trigger / pg_net / GUC wiring is needed.

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
