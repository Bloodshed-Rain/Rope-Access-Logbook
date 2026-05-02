// src/screens/TodayScreen.tsx
// Light-theme home screen. Greeting + hours-today hero + supervisor
// incoming-requests card (when capability on) + needs-signature card +
// cert-progress card. Top-right bell opens NotificationsScreen.

import React, { useMemo, useState, useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react-native';
import { Screen, Button, Banner } from '../primitives';
import { StatCard } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useSignRequests } from '../hooks/useSignRequests';
import { useTodayHours } from '../hooks/useTodayHours';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { useReadOnly } from '../hooks/useSubscription';
import {
  useCertProgress,
  useRecert,
  useDashboardStats,
} from '../hooks/useCertProgress';
import { useAuthSession } from '../hooks/useAuthSession';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { entryRequiredFieldsFilled } from '../utils/entryComplete';
import { TechSittingIllustration } from '../components/illustrations/TechSittingIllustration';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function recertCaption(daysToExpiry: number, state: string): string {
  if (state === 'expired') return `Re-cert expired ${Math.abs(daysToExpiry)}d ago`;
  if (state === 'expires-today') return 'Re-cert expires today';
  return `Re-cert in ${daysToExpiry}d`;
}

export function TodayScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);

  const { data: profile } = useProfile();
  const { data: entries = [] } = useEntries();
  const todayHours = useTodayHours();
  const { unreadCount } = useNotificationCenter();
  const { session } = useAuthSession(cloud);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const readOnly = useReadOnly();

  // Lapsed users tapping a write CTA get routed to Paywall instead of the
  // write surface. The button stays visually active so the redirect reads
  // as "this needs a subscription" rather than "this control is broken".
  const handleAddWork = () => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('EntryForm', {});
  };

  const scheme = profile?.primary_cert ?? 'sprat';
  const { data: certData } = useCertProgress(scheme);
  const { data: recertData } = useRecert(scheme);
  const { data: stats } = useDashboardStats(new Date().getFullYear());

  const supervisorMode = !!profile?.supervisor_capability_enabled;
  const incomingRequests = signReqs.query.data ?? [];
  const incomingCount = supervisorMode && session
    ? incomingRequests.filter(
        (r) => r.status === 'pending' && r.supervisor_user_id === session.user_id,
      ).length
    : 0;

  const needsSignatureCount = entries.filter(
    (e) =>
      e.status === 'draft' &&
      !e.pending_sign_request_id &&
      entryRequiredFieldsFilled(e),
  ).length;

  // Pull-to-refresh: invalidate React Query keys whose queryFn already calls
  // service.sync() under the hood. Cheaper than re-instantiating services
  // here and keeps drift away from the App.tsx foreground-sync wiring.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sign_requests'] }),
        qc.invalidateQueries({ queryKey: ['entries'] }),
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      // Supervisor-connections sync runs from InboxScreen and from App.tsx's
      // foreground listener — not invalidated here since Today doesn't render
      // anything keyed off the connections list.
      // TODO: also kick off cloud-state preview when signed in. The hook
      // currently lives at RootNavigator scope; refactoring that out is
      // outside C1's scope.
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  // Cert-progress card content. L3/max-level path follows spec §4 line 179:
  // show lifetime hours and a re-cert reminder strip.
  let certCardBig = '—';
  let certCardCaption: string | undefined;
  let certProgressValue: number | undefined;
  if (certData) {
    if (certData.isMaxLevel) {
      const lifetime = stats?.lifetimeHours ?? certData.hoursAtLevel;
      certCardBig = `Level III · ${lifetime.toFixed(1)}h`;
      certCardCaption = 'Lifetime hours';
    } else {
      const target = certData.target ?? 0;
      certCardBig = `${certData.hoursAtLevel.toFixed(0)} / ${target}`;
      certCardCaption = `${certData.remaining.toFixed(0)} hours to go`;
      certProgressValue =
        target > 0
          ? Math.min(1, certData.hoursAtLevel / target)
          : undefined;
    }
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <Screen padded={false}>
      {/* Header — title left, bell right */}
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
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Today</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          onPress={() => navigation.navigate('Notifications')}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bell color={colors.textPrimary} size={22} />
          {unreadCount > 0 && (
            <View
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 8,
                height: 8,
                borderRadius: radii.pill,
                backgroundColor: colors.statusErr,
              }}
            />
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accentPrimary}
          />
        }
      >
        {/* Greeting */}
        <View>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {greeting()},
          </Text>
          <Text
            style={[
              typography.title1,
              { color: colors.textPrimary, marginTop: spacing.xs },
            ]}
          >
            {firstName}
          </Text>
        </View>

        {/* Hero: hours today */}
        <StatCard
          big={`${todayHours}h`}
          title="logged today"
          illustration={<TechSittingIllustration />}
        />

        {/* Read-only banner — lapsed subscription. The Me-tab's
            SubscriptionStrip carries the same message in more detail; this
            banner is the inline reminder on screens with write CTAs. */}
        {readOnly && (
          <Banner
            variant="warning"
            message="Subscription lapsed — renew to add new entries"
            actionLabel="Renew"
            onAction={() => navigation.navigate('Paywall')}
          />
        )}

        {/* + Add work CTA — gated. */}
        <Button title="+ Add work" variant="primary" onPress={handleAddWork} />

        {/* Supervisor incoming requests */}
        {supervisorMode && incomingCount > 0 && (
          <StatCard
            title="Incoming sign requests"
            big={`${incomingCount}`}
            caption="Tap to review"
            onPress={() =>
              navigation.navigate('Main', { screen: 'Inbox' })
            }
          />
        )}

        {/* Needs signature */}
        {needsSignatureCount > 0 && (
          <StatCard
            title="Needs signature"
            big={`${needsSignatureCount}`}
            caption={needsSignatureCount === 1 ? 'entry ready to sign' : 'entries ready to sign'}
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'Records',
                params: { filter: 'needs_signature' },
              })
            }
          />
        )}

        {/* Cert progress (skipped until profile + cert data resolve) */}
        {profile && certData && (
          <StatCard
            title="Certification"
            big={certCardBig}
            caption={certCardCaption}
            progress={certProgressValue}
          />
        )}

        {/* Re-cert strip — L3 only, per spec §4 line 179 */}
        {profile && certData?.isMaxLevel && recertData && (
          <View
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              backgroundColor:
                recertData.state === 'safe'
                  ? colors.statusOkTint
                  : recertData.state === 'expired'
                    ? colors.statusErrTint
                    : colors.statusWarnTint,
            }}
          >
            <Text
              style={[
                typography.label,
                {
                  color:
                    recertData.state === 'safe'
                      ? colors.statusOk
                      : recertData.state === 'expired'
                        ? colors.statusErr
                        : colors.statusWarn,
                },
              ]}
            >
              {recertCaption(recertData.daysToExpiry, recertData.state)}
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
