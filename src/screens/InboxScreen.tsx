import React, { useMemo } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Card, Button, ListRow, EmptyState, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useSignRequests } from '../hooks/useSignRequests';
import { useAuthSession } from '../hooks/useAuthSession';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function InboxScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const { session } = useAuthSession(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });

  if (!session) return null;

  const connections = conns.query.data ?? [];
  const incoming = connections.filter(
    (c) => c.supervisor_user_id === session.user_id && c.status === 'pending',
  );

  const allRequests = signReqs.query.data ?? [];
  const incomingRequests = allRequests.filter(
    (r) => r.supervisor_user_id === session.user_id && r.status === 'pending',
  );
  const history = allRequests
    .filter((r) => r.supervisor_user_id === session.user_id && r.status !== 'pending')
    .slice(0, 50);

  return (
    <Screen topDivider>
      <ScrollView
        contentContainerStyle={{
          gap: spacing.base,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
        }}
      >
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Inbox</Text>

        <SectionHeader label="CONNECTION REQUESTS" />
        {incoming.length === 0 ? (
          <EmptyState
            title="No incoming requests"
            subtitle="Techs who put in a connection request appear here."
            actionLabel="REFRESH"
            onAction={() => conns.query.refetch()}
          />
        ) : (
          incoming.map((c) => (
            <Card key={c.id} accent="navy">
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

        <SectionHeader label="SIGN REQUESTS" />
        {incomingRequests.length === 0 && (
          <Card accent="orange">
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              No pending sign requests.
            </Text>
          </Card>
        )}
        {incomingRequests.map((r) => {
          const entry = r.entry_payload;
          return (
            <Card key={r.id} accent="orange">
              <ListRow
                title={`${entry.date_from} — ${entry.site}`}
                subtitle={`${entry.work_hours}h · ${entry.employer}`}
                right={
                  <Button
                    title="Open"
                    onPress={() => navigation.navigate('SignRequestDetail', { requestId: r.id })}
                  />
                }
                onPress={() => navigation.navigate('SignRequestDetail', { requestId: r.id })}
              />
            </Card>
          );
        })}

        {history.length > 0 && (
          <>
            <SectionHeader label="HISTORY" />
            {history.map((r) => {
              const entry = r.entry_payload;
              return (
                <Card key={r.id}>
                  <ListRow
                    title={`${entry.date_from} — ${entry.site}`}
                    subtitle={`${r.status}${r.decline_reason ? ` — ${r.decline_reason}` : ''}`}
                    onPress={() => {}}
                  />
                </Card>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
