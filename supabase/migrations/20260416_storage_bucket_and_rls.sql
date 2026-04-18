-- supabase/migrations/20260416_storage_bucket_and_rls.sql

-- Create the private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('logbook-backups', 'logbook-backups', false)
ON CONFLICT (id) DO NOTHING;

-- Own-prefix RLS policy
DROP POLICY IF EXISTS "own_prefix_rw" ON storage.objects;
CREATE POLICY "own_prefix_rw" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'logbook-backups'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
