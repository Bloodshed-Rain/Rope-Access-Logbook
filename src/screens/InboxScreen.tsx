import React, { useMemo } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Screen, Card, Button, EmptyState } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useAuthSession } from '../hooks/useAuthSession';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';

export function InboxScreen() {
  const { colors, spacing, typography } = useTheme();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const { session } = useAuthSession(cloud);
  const conns = useSupervisorConnections({ db, cloud });

  if (!session) return null;

  const connections = conns.query.data ?? [];
  const incoming = connections.filter(
    (c) => c.supervisor_user_id === session.user_id && c.status === 'pending',
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          gap: spacing.base,
          paddingVertical: spacing.base,
          paddingBottom: spacing.xxl,
        }}
      >
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Inbox</Text>

        <Text style={[typography.h2, { color: colors.textPrimary }]}>Connection requests</Text>
        {incoming.length === 0 ? (
          <EmptyState
            title="No incoming requests"
            subtitle="Techs who add you as their supervisor appear here."
          />
        ) : (
          incoming.map((c) => (
            <Card key={c.id}>
              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {c.invited_email}
                </Text>
                <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
                  wants to add you as their supervisor
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                  <Button
                    title="Accept"
                    onPress={async () => {
                      try {
                        await conns.accept.mutateAsync(c.id);
                      } catch (e) {
                        Alert.alert('Could not accept', (e as Error).message);
                      }
                    }}
                  />
                  <Button
                    title="Decline"
                    variant="ghost"
                    onPress={async () => {
                      try {
                        await conns.decline.mutateAsync(c.id);
                      } catch (e) {
                        Alert.alert('Could not decline', (e as Error).message);
                      }
                    }}
                  />
                </View>
              </View>
            </Card>
          ))
        )}

        <Text style={[typography.h2, { color: colors.textPrimary }]}>Sign requests</Text>
        <EmptyState
          title="No sign requests yet"
          subtitle="Techs can send you entries to sign. They'll appear here."
        />
      </ScrollView>
    </Screen>
  );
}
