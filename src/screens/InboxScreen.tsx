// src/screens/InboxScreen.tsx
// Light-theme Inbox tab — supervisor-side view of pending invites and
// incoming sign requests. SectionList of two sections + a centered empty
// state when both are empty. Pull-to-refresh + manual refresh button both
// invalidate React Query keys (queryFns already call service.sync()).

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Inbox, RefreshCw } from 'lucide-react-native';
import { Screen, Button } from '../primitives';
import { StatusPill } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useSignRequests } from '../hooks/useSignRequests';
import { useAuthSession } from '../hooks/useAuthSession';
import { useReadOnly } from '../hooks/useSubscription';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { pillForSignRequest } from '../utils/entryStatusPill';
import { formatEntryDateRange } from '../utils/dateRange';
import { SignRequest, SupervisorConnection } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type InviteItem = { kind: 'invite'; data: SupervisorConnection };
type RequestItem = { kind: 'request'; data: SignRequest };
type RowItem = InviteItem | RequestItem;

interface InboxSection {
  title: string;
  data: RowItem[];
}

export function InboxScreen() {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const { session } = useAuthSession(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const readOnly = useReadOnly();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['supervisor_connections'] }),
        qc.invalidateQueries({ queryKey: ['sign_requests'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  const incomingInvites = useMemo<SupervisorConnection[]>(() => {
    if (!session) return [];
    return (conns.query.data ?? []).filter(
      (c) => c.supervisor_user_id === session.user_id && c.status === 'pending',
    );
  }, [conns.query.data, session]);

  const incomingRequests = useMemo<SignRequest[]>(() => {
    if (!session) return [];
    return (signReqs.query.data ?? []).filter(
      (r) => r.supervisor_user_id === session.user_id && r.status === 'pending',
    );
  }, [signReqs.query.data, session]);

  if (!session) return null;

  const sections: InboxSection[] = [];
  if (incomingInvites.length > 0) {
    sections.push({
      title: 'Pending invites',
      data: incomingInvites.map((c) => ({ kind: 'invite' as const, data: c })),
    });
  }
  if (incomingRequests.length > 0) {
    sections.push({
      title: 'Incoming sign requests',
      data: incomingRequests.map((r) => ({ kind: 'request' as const, data: r })),
    });
  }

  const isEmpty = sections.length === 0;

  const handleAccept = async (id: string) => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    try {
      await conns.accept.mutateAsync(id);
    } catch (e) {
      Alert.alert('Could not accept', (e as Error).message);
    }
  };

  const handleDecline = async (id: string) => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    try {
      await conns.decline.mutateAsync(id);
    } catch (e) {
      Alert.alert('Could not decline', (e as Error).message);
    }
  };

  const renderRow = ({ item }: { item: RowItem }) => {
    if (item.kind === 'invite') {
      const c = item.data;
      const techLabel = c.invited_email || 'A tech';
      return (
        <View
          style={{
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.md,
            backgroundColor: colors.bgSurface,
            borderBottomWidth: borders.hair,
            borderBottomColor: colors.divider,
            gap: spacing.sm,
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={[typography.bodyMed, { color: colors.textPrimary }]} numberOfLines={1}>
              {techLabel}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              wants to add you as a supervisor
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Accept"
                variant="primary"
                onPress={() => handleAccept(c.id)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Decline"
                variant="ghost"
                onPress={() => handleDecline(c.id)}
              />
            </View>
          </View>
        </View>
      );
    }

    const r = item.data;
    const entry = r.entry_payload;
    const dateRangeText = formatEntryDateRange(
      entry.date_from,
      entry.date_to || entry.date_from,
    );
    const pill = pillForSignRequest(r.status);
    const techHint = entry.employer ? `${entry.employer}` : null;
    return (
      <Pressable
        onPress={() => navigation.navigate('SignRequestDetail', { requestId: r.id })}
        accessibilityRole="button"
        accessibilityLabel={`Sign request for ${entry.site || 'entry'}, ${dateRangeText}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.divider,
          minHeight: 64,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[typography.bodyMed, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {entry.site || '(no site)'}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {dateRangeText}
            {techHint ? (
              <Text style={{ color: colors.textDisabled }}>{`  ·  ${techHint}`}</Text>
            ) : null}
          </Text>
        </View>
        <View style={{ marginLeft: spacing.sm }}>
          <StatusPill variant={pill.variant} label={pill.label} />
        </View>
        <View style={{ marginLeft: spacing.sm }}>
          <ChevronRight size={20} color={colors.textDisabled} />
        </View>
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: InboxSection }) => (
    <View
      style={{
        backgroundColor: colors.bgApp,
        paddingHorizontal: spacing.base,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
      }}
    >
      <Text style={[typography.label, { color: colors.textSecondary }]}>
        {section.title}
      </Text>
    </View>
  );

  return (
    <Screen padded={false}>
      {/* Header — title left, refresh right */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Inbox</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh inbox"
          onPress={onRefresh}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RefreshCw color={colors.textPrimary} size={20} />
        </Pressable>
      </View>

      {isEmpty ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            gap: spacing.md,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radii.pill,
              backgroundColor: colors.bgMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Inbox size={32} color={colors.textDisabled} />
          </View>
          <Text
            style={[
              typography.title2,
              { color: colors.textPrimary, textAlign: 'center' },
            ]}
          >
            No pending items
          </Text>
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            Pending invites and incoming sign requests will appear here.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.kind}:${item.data.id}`}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accentPrimary}
            />
          }
        />
      )}
    </Screen>
  );
}
