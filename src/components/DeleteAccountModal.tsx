import React, { useState } from 'react';
import { Modal, View, Text } from 'react-native';
import { Button, Input, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';
import { DbClient } from '../db/client';

interface DeleteAccountModalProps {
  visible: boolean;
  onDone: () => void;
  db: DbClient;
}

export function DeleteAccountModal({ visible, onDone, db }: DeleteAccountModalProps) {
  const { colors, spacing, radii, typography } = useTheme();
  const [step, setStep] = useState<'confirm' | 'type' | 'deleting'>('confirm');
  const [typed, setTyped] = useState('');
  const toast = useToast();

  async function doDelete() {
    setStep('deleting');
    const cloud = createSupabaseCloudClient();
    const auth = createAuthService(cloud);
    try {
      await auth.deleteAccount();
      await db.run(
        `UPDATE profile SET last_cloud_backup_at = NULL, last_uploaded_backup_id = NULL, updated_at = ?`,
        [new Date().toISOString()],
      );
      toast.show({ message: 'Account deleted', variant: 'ok' });
    } catch (e) {
      toast.show({ message: `Delete failed: ${(e as Error).message}`, variant: 'err' });
    } finally {
      setStep('confirm');
      setTyped('');
      onDone();
    }
  }

  function cancel() {
    setStep('confirm');
    setTyped('');
    onDone();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center' }}>
        <View
          style={{
            backgroundColor: colors.surface,
            margin: spacing.base,
            padding: spacing.base,
            borderRadius: radii.md,
            gap: spacing.md,
          }}
        >
          {step === 'confirm' && (
            <>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                Delete cloud backup?
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                This permanently deletes your cloud backup. Your on-device logbook will remain
                intact. This cannot be undone.
              </Text>
              <Button title="Cancel" variant="secondary" onPress={cancel} />
              <Button title="Continue" variant="danger" onPress={() => setStep('type')} />
            </>
          )}
          {step === 'type' && (
            <>
              <Text style={[typography.h2, { color: colors.textPrimary }]}>
                Type DELETE to confirm
              </Text>
              <Input
                label="Confirmation"
                value={typed}
                onChangeText={setTyped}
                placeholder="DELETE"
                autoCapitalize="characters"
              />
              <Button title="Cancel" variant="secondary" onPress={cancel} />
              <Button
                title="Delete"
                variant="danger"
                onPress={doDelete}
                disabled={typed !== 'DELETE'}
              />
            </>
          )}
          {step === 'deleting' && (
            <Text style={[typography.body, { color: colors.textPrimary }]}>Deleting…</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
