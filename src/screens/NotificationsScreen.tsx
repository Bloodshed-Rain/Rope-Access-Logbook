// src/screens/NotificationsScreen.tsx
// In-app notification center reachable from the Today bell. Renders local
// notification rows grouped by day with mark-all-read + long-press dismiss.
// All write-side recording happens elsewhere (signRequestsService for tech-
// side signed events; useNotifications for push-derived events; App.tsx for
// foreground cert-expiry / backup-stale checks). This screen is read-only.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CloudOff,
  Inbox as InboxIcon,
  TrendingUp,
  Undo2,
  Wrench,
  XCircle,
} from 'lucide-react-native';
import { Screen, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import {
  NotificationKind,
  NotificationRow,
} from '../services/notificationCenterService';
import { getDayLabel, getRelativeTime } from '../utils/dateRange';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface KindMeta {
  title: string;
  body: string;
  Icon: React.ComponentType<{ color: string; size: number }>;
  iconColor: 'textSecondary' | 'statusOk' | 'statusErr' | 'statusWarn' | 'accentPrimary';
}

function metaForKind(item: NotificationRow): KindMeta {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  // Tech / supervisor display names aren't currently snapshotted into the
  // notification payload (sign_requests_cache lacks the columns), so we fall
  // back to actor-neutral copy. The previous "A tech …" / "Your supervisor …"
  // placeholders read as misleading, since they implied a name was redacted.
  const supervisorName = typeof p.supervisorName === 'string' && p.supervisorName ? p.supervisorName : null;
  const techName = typeof p.techName === 'string' && p.techName ? p.techName : null;
  const reason = typeof p.reason === 'string' && p.reason ? ` — ${p.reason}` : '';
  const scheme = typeof p.scheme === 'string' ? p.scheme.toUpperCase() : 'cert';
  const daysUntil = typeof p.daysUntil === 'number' ? p.daysUntil : null;
  const daysSince = typeof p.daysSince === 'number' ? p.daysSince : null;

  switch (item.kind as NotificationKind) {
    case 'sign_request_received':
      return {
        title: 'New sign-request',
        body: techName
          ? `${techName} sent you a sign-request`
          : 'A tech sent you a sign-request — tap to review',
        Icon: InboxIcon,
        iconColor: 'accentPrimary',
      };
    case 'sign_request_signed':
      return {
        title: 'Signature received',
        body: supervisorName
          ? `${supervisorName} signed your entry`
          : 'Your sign-request was signed',
        Icon: CheckCircle2,
        iconColor: 'statusOk',
      };
    case 'sign_request_declined':
      return {
        title: 'Sign-request declined',
        body: supervisorName
          ? `${supervisorName} declined${reason}`
          : `Your sign-request was declined${reason}`,
        Icon: XCircle,
        iconColor: 'statusErr',
      };
    case 'sign_request_withdrawn':
      return {
        title: 'Sign-request withdrawn',
        body: techName
          ? `${techName} withdrew their request`
          : 'A pending sign-request was withdrawn',
        Icon: Undo2,
        iconColor: 'textSecondary',
      };
    case 'cert_expiry_60d':
      return {
        title: 'Certification expires soon',
        body: daysUntil != null
          ? `${daysUntil} days until your ${scheme} cert expires`
          : `Your ${scheme} cert expires soon`,
        Icon: AlertTriangle,
        iconColor: 'statusWarn',
      };
    case 'cert_expiry_0d':
      return {
        title: 'Certification expired today',
        body: `Renew your ${scheme} cert to stay current`,
        Icon: AlertTriangle,
        iconColor: 'statusErr',
      };
    case 'level_upgrade':
      return {
        title: typeof p.level === 'string' ? `You've reached Level ${p.level}` : 'Level upgrade',
        body: 'Update your profile to reflect the new level',
        Icon: TrendingUp,
        iconColor: 'statusOk',
      };
    case 'backup_stale':
      return {
        title: 'Backup is stale',
        body: daysSince != null
          ? `${daysSince} days since your last cloud backup`
          : 'Your cloud backup is out of date',
        Icon: CloudOff,
        iconColor: 'statusWarn',
      };
    case 'gear_inspection_30d': {
      const name = typeof p.name === 'string' ? p.name : 'A gear item';
      const dueOn = typeof p.dueOn === 'string' ? p.dueOn : null;
      return {
        title: 'Gear inspection due soon',
        body: dueOn ? `${name} is due ${dueOn}` : `${name} is due for inspection`,
        Icon: Wrench,
        iconColor: 'statusWarn',
      };
    }
    case 'gear_inspection_0d': {
      const name = typeof p.name === 'string' ? p.name : 'A gear item';
      return {
        title: 'Gear inspection due today',
        body: `${name} — don't use it on rope until it's been inspected`,
        Icon: Wrench,
        iconColor: 'statusErr',
      };
    }
    default:
      return {
        title: String(item.kind),
        body: '',
        Icon: Bell,
        iconColor: 'textSecondary',
      };
  }
}

function groupByDay(items: NotificationRow[]): Array<{ title: string; data: NotificationRow[] }> {
  const map = new Map<string, NotificationRow[]>();
  const now = new Date();
  for (const item of items) {
    const label = getDayLabel(item.created_at, now);
    const arr = map.get(label) ?? [];
    arr.push(item);
    map.set(label, arr);
  }
  // Items already arrive newest-first from the service; insertion order on
  // the Map preserves that, and within each section the relative order
  // matches the parent list.
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export function NotificationsScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const { items, unreadCount, markAllRead, dismiss, isLoading } = useNotificationCenter();

  const sections = useMemo(() => groupByDay(items), [items]);

  // Auto mark-all-read after a short delay so the badge clears once the user
  // has plausibly seen the list. Mirrors typical inbox UX. The header button
  // remains visible for explicit control while there are still unread items
  // (the timer hasn't fired yet, or the user re-entered the screen during
  // the interval).
  const autoReadFiredRef = useRef(false);
  useEffect(() => {
    if (autoReadFiredRef.current) return;
    if (isLoading) return;
    if (unreadCount === 0) return;
    const t = setTimeout(() => {
      if (autoReadFiredRef.current) return;
      autoReadFiredRef.current = true;
      markAllRead();
    }, 1500);
    return () => clearTimeout(t);
  }, [isLoading, unreadCount, markAllRead]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  const handlePress = useCallback((item: NotificationRow) => {
    const p = (item.payload ?? {}) as Record<string, unknown>;
    switch (item.kind as NotificationKind) {
      case 'sign_request_received':
      case 'sign_request_signed':
      case 'sign_request_declined':
      case 'sign_request_withdrawn': {
        const requestId = typeof p.requestId === 'string' ? p.requestId : null;
        if (requestId) navigation.navigate('SignRequestDetail', { requestId });
        return;
      }
      case 'cert_expiry_60d':
      case 'cert_expiry_0d':
      case 'level_upgrade':
      case 'backup_stale':
        navigation.navigate('Main', { screen: 'Me' });
        return;
      case 'gear_inspection_30d':
      case 'gear_inspection_0d': {
        const gearId = typeof p.gearId === 'string' ? p.gearId : null;
        if (gearId) navigation.navigate('GearDetail', { gearId });
        return;
      }
    }
  }, [navigation]);

  const handleLongPress = useCallback((item: NotificationRow) => {
    // Confirm before dismissing — long-press is easy to fire by accident
    // when scrolling, and dismiss is a one-way action (the row sets
    // dismissed_at and won't reappear).
    Alert.alert(
      'Dismiss notification?',
      'This removes the notification from your bell.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', style: 'destructive', onPress: () => dismiss(item.id) },
      ],
    );
  }, [dismiss]);

  if (isLoading) {
    return <LoadingSpinner fullScreen label="Loading notifications" />;
  }

  if (items.length === 0) {
    return (
      <Screen padded={false}>
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
          <Text style={[typography.title1, { color: colors.textPrimary }]}>
            Notifications
          </Text>
        </View>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.xxl,
            gap: spacing.md,
          }}
        >
          <Bell color={colors.textDisabled} size={56} />
          <Text style={[typography.title2, { color: colors.textPrimary, textAlign: 'center' }]}>
            No notifications yet
          </Text>
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            You'll see sign-request updates and reminders here.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {/* Header — title left, "Mark all read" right (only when unread > 0). */}
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
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <Pressable
            onPress={() => markAllRead()}
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
            hitSlop={8}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.sm,
            })}
          >
            <Text style={[typography.label, { color: colors.accentPrimary }]}>
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accentPrimary}
          />
        }
        renderSectionHeader={({ section: { title } }) => (
          <View
            style={{
              paddingTop: spacing.md,
              paddingBottom: spacing.xs,
            }}
          >
            <Text style={[typography.label, { color: colors.textSecondary }]}>
              {title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const meta = metaForKind(item);
          const iconColor = colors[meta.iconColor];
          const unread = item.read_at == null;
          return (
            <Pressable
              onPress={() => handlePress(item)}
              onLongPress={() => handleLongPress(item)}
              accessibilityRole="button"
              accessibilityLabel={`${meta.title}. ${meta.body}. Long-press to dismiss.`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.md,
                backgroundColor: pressed
                  ? colors.bgMuted
                  : unread
                    ? colors.bgSurface
                    : 'transparent',
                borderRadius: radii.md,
                marginBottom: spacing.xs,
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.bgMuted,
                }}
              >
                <meta.Icon color={iconColor} size={20} />
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: spacing.sm,
                  }}
                >
                  <Text
                    style={[
                      typography.bodyMed,
                      { color: colors.textPrimary, flex: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {meta.title}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    {getRelativeTime(item.created_at)}
                  </Text>
                </View>
                {meta.body ? (
                  <Text
                    style={[typography.body, { color: colors.textSecondary }]}
                    numberOfLines={2}
                  >
                    {meta.body}
                  </Text>
                ) : null}
              </View>
              {unread && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: radii.pill,
                    backgroundColor: colors.accentPrimary,
                    marginTop: 14,
                  }}
                />
              )}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
