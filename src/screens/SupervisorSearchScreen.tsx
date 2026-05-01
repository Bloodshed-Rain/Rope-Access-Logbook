import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, Card, Chip, ListRow, Banner, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorSearch } from '../hooks/useSupervisorSearch';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import { useSubscriptionStatus } from '../hooks/useSubscription';
import { Search } from 'lucide-react-native';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorSearchScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const search = useSupervisorSearch(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const { isPaid } = useSubscriptionStatus();
  const [tab, setTab] = useState<SupervisorSearchKind>('email');
  const [query, setQuery] = useState('');

  const runSearch = async () => {
    if (!isPaid) {
      navigation.navigate('Paywall');
      return;
    }
    if (tab === 'email') {
      if (!query.trim()) return;
      try {
        await conns.inviteByEmail.mutateAsync(query.trim());
        Alert.alert('Invite sent', `An invite was sent to ${query.trim()}.`);
        navigation.goBack();
      } catch (e) {
        Alert.alert('Could not invite', (e as Error).message);
      }
    } else {
      await search.search(tab, query.trim());
    }
  };

  const sendRequest = async (result: SupervisorSearchResult) => {
    try {
      await conns.inviteByDirectoryResult.mutateAsync({ result, invitedEmail: '' });
      Alert.alert('Request sent', `A connection request was sent to ${result.display_name}.`);
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
    <Screen topDivider>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl, padding: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.xs }}>
          <Text style={[typography.h1, { color: colors.textPrimary }]}>Directory Search</Text>
        </View>

        {!isPaid && (
          <Banner variant="info" message="Remote Supervisor Signatures are a Pro feature." />
        )}

        <SectionHeader label="SEARCH BY" />
        <Card accent="navy" style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Chip
              label="Email"
              selected={tab === 'email'}
              onPress={() => {
                setTab('email');
                setQuery('');
              }}
            />
            <Chip
              label="SPRAT ID"
              selected={tab === 'sprat_id'}
              onPress={() => {
                setTab('sprat_id');
                setQuery('');
              }}
            />
            <Chip
              label="Name"
              selected={tab === 'name'}
              onPress={() => {
                setTab('name');
                setQuery('');
              }}
            />
          </View>

          <Input
            label={
              tab === 'email'
                ? 'Supervisor email'
                : tab === 'sprat_id'
                  ? 'SPRAT cert number'
                  : 'Name (3+ chars)'
            }
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              if (tab === 'name' && v.trim().length >= 3) search.search('name', v.trim());
            }}
            autoCapitalize={tab === 'sprat_id' ? 'characters' : 'none'}
            keyboardType={tab === 'email' ? 'email-address' : 'default'}
          />

          <Button
            title={tab === 'email' ? 'Send invite' : 'Search Directory'}
            onPress={runSearch}
            disabled={(!query.trim() && isPaid) || (tab === 'name' && query.trim().length < 3)}
            haptic
          />
        </Card>

        {search.error && <Banner variant="warning" message={search.error} />}

        {tab !== 'email' && search.results.length > 0 && (
          <SectionHeader label="RESULTS" />
        )}
        {tab !== 'email' &&
          search.results.map((r) => (
            <Card key={r.user_id} accent="navy">
              <ListRow
                title={r.display_name}
                subtitle={r.sprat_cert_number}
                onPress={() => sendRequest(r)}
                right={<Button title="Send request" onPress={() => sendRequest(r)} />}
              />
            </Card>
          ))}

        {tab !== 'email' && !search.isSearching && search.results.length === 0 && query.trim() && (
          <View style={{ alignItems: 'center', marginTop: spacing.xl, padding: spacing.xl }}>
            <Search color={colors.border} size={48} />
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md }]}>
              No supervisors found in the directory. Try the Email tab to send an invite directly.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
