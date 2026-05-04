// src/screens/SupervisorSearchScreen.tsx
// Light-theme directory search. SegmentedControl picks the search mode
// (Cert # / Email / Name); the input below adapts placeholder and keyboard
// per mode. Cert # / Name run a directory search and render rows with a
// "Send request" CTA; Email skips the directory and sends an invite
// straight to the supplied address.
//
// ProBadge / Pro gating was dropped in A4 — every authenticated user can
// search the directory.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextStyle,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Search as SearchIcon } from 'lucide-react-native';
import { Screen, Button, Banner } from '../primitives';
import { SegmentedControl } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorSearch } from '../hooks/useSupervisorSearch';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useReadOnly } from '../hooks/useSubscription';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// SegmentedControl talks in plain string `value`s. We map the v2 control
// values onto the existing service kinds so nothing in the data layer has
// to change.
const MODE_OPTIONS: Array<{ value: SupervisorSearchKind; label: string }> = [
  { value: 'sprat_id', label: 'Cert #' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Name' },
];

function placeholderFor(mode: SupervisorSearchKind): string {
  if (mode === 'sprat_id') return 'SPRAT cert number';
  if (mode === 'email') return 'Email address';
  return 'First or last name';
}

function ctaLabelFor(mode: SupervisorSearchKind): string {
  if (mode === 'email') return 'Send invite';
  return 'Search directory';
}

export function SupervisorSearchScreen() {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const navigation = useNavigation<Nav>();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const search = useSupervisorSearch(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const readOnly = useReadOnly();

  const [mode, setMode] = useState<SupervisorSearchKind>('sprat_id');
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const ctaDisabled =
    trimmed.length === 0 || (mode === 'name' && trimmed.length < 3);

  const runSearch = async () => {
    if (mode === 'email') {
      if (!trimmed) return;
      if (readOnly) {
        navigation.navigate('Paywall');
        return;
      }
      try {
        await conns.inviteByEmail.mutateAsync(trimmed);
        Alert.alert('Invite sent', `An invite was sent to ${trimmed}.`);
        navigation.goBack();
      } catch (e) {
        Alert.alert('Could not invite', (e as Error).message);
      }
      return;
    }
    if (!trimmed) return;
    if (mode === 'name' && trimmed.length < 3) return;
    await search.search(mode, trimmed);
  };

  const sendRequest = async (result: SupervisorSearchResult) => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    try {
      await conns.inviteByDirectoryResult.mutateAsync({
        result,
        invitedEmail: '',
      });
      Alert.alert(
        'Request sent',
        `A connection request was sent to ${result.display_name}.`,
      );
      navigation.goBack();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'cooldown_active') {
        Alert.alert(
          'Cooldown active',
          'You declined (or were declined by) this supervisor recently. Try again in a few weeks.',
        );
      } else {
        Alert.alert('Could not send', msg);
      }
    }
  };

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          Add supervisor
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <SegmentedControl
          options={MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={mode}
          onChange={(v) => {
            setMode(v as SupervisorSearchKind);
            setQuery('');
          }}
        />

        {/* Search input */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.bgMuted,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            minHeight: 44,
          }}
        >
          <SearchIcon size={18} color={colors.textDisabled} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <SearchInput
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                // Live search for Name only (matches the previous screen's
                // behavior); Cert # users hit the CTA explicitly.
                if (mode === 'name' && v.trim().length >= 3) {
                  search.search('name', v.trim());
                }
              }}
              placeholder={placeholderFor(mode)}
              placeholderTextColor={colors.textDisabled}
              textColor={colors.textPrimary}
              fontStyle={typography.body}
              autoCapitalize={mode === 'sprat_id' ? 'characters' : 'none'}
              keyboardType={mode === 'email' ? 'email-address' : 'default'}
            />
          </View>
        </View>

        <Button
          title={ctaLabelFor(mode)}
          variant="primary"
          onPress={runSearch}
          disabled={ctaDisabled}
          haptic
        />

        {search.error && <Banner variant="warning" message={search.error} />}

        {/* Results — only meaningful for non-email modes */}
        {mode !== 'email' && search.results.length > 0 && (
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>
              Results
            </Text>
            <View
              style={{
                borderRadius: radii.md,
                backgroundColor: colors.bgSurface,
                borderWidth: borders.hair,
                borderColor: colors.border,
                overflow: 'hidden',
              }}
            >
              {search.results.map((r, idx) => (
                <View
                  key={r.user_id}
                  style={{
                    paddingHorizontal: spacing.base,
                    paddingVertical: spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    borderBottomWidth:
                      idx === search.results.length - 1 ? 0 : borders.hair,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={[typography.bodyMed, { color: colors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {r.display_name}
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {r.sprat_cert_number}
                      {r.sprat_cert_number_is_masked ? '  ·  masked' : ''}
                    </Text>
                  </View>
                  <Button
                    title="Send request"
                    variant="secondary"
                    onPress={() => sendRequest(r)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Empty state when a search has run but came up dry */}
        {mode !== 'email' &&
          !search.isSearching &&
          search.results.length === 0 &&
          trimmed.length > 0 && (
            <View
              style={{
                alignItems: 'center',
                paddingVertical: spacing.xl,
                gap: spacing.md,
              }}
            >
              <SearchIcon size={36} color={colors.textDisabled} />
              <Text
                style={[
                  typography.body,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                No supervisors found in the directory. Try the Email tab to send
                an invite directly.
              </Text>
            </View>
          )}
      </ScrollView>
    </Screen>
  );
}

// Inline themed text input — mirrors the pattern in RecordsScreen so the
// search row can stay un-labeled without dragging in the labelled `Input`
// primitive.
function SearchInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  placeholderTextColor: string;
  textColor: string;
  fontStyle: TextStyle;
  autoCapitalize: 'characters' | 'none';
  keyboardType: 'email-address' | 'default';
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={props.placeholderTextColor}
      style={[props.fontStyle, { color: props.textColor, paddingVertical: 0 }]}
      autoCapitalize={props.autoCapitalize}
      autoCorrect={false}
      keyboardType={props.keyboardType}
      returnKeyType="search"
      accessibilityLabel="Search supervisors"
    />
  );
}
