import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, Card, Chip, ListRow, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorSearch } from '../hooks/useSupervisorSearch';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorSearchScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const search = useSupervisorSearch(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const [tab, setTab] = useState<SupervisorSearchKind>('email');
  const [query, setQuery] = useState('');

  const runSearch = async () => {
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
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl, padding: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Add supervisor</Text>

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
          title={tab === 'email' ? 'Send invite' : 'Search'}
          onPress={runSearch}
          disabled={!query.trim() || (tab === 'name' && query.trim().length < 3)}
        />

        {search.error && <Banner variant="warning" message={search.error} />}

        {tab !== 'email' &&
          search.results.map((r) => (
            <Card key={r.user_id}>
              <ListRow
                title={r.display_name}
                subtitle={r.sprat_cert_number}
                onPress={() => sendRequest(r)}
                right={<Button title="Send request" onPress={() => sendRequest(r)} />}
              />
            </Card>
          ))}

        {tab !== 'email' && !search.isSearching && search.results.length === 0 && query.trim() && (
          <Banner variant="info" message="No supervisors found. Try the Email tab to invite by email." />
        )}
      </ScrollView>
    </Screen>
  );
}
