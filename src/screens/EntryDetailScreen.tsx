// src/screens/EntryDetailScreen.tsx
import React from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Screen, Card, Button, Badge, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry, useDeleteEntry, useAmendmentForEntry } from '../hooks/useEntries';
import { useSignatureForEntry, useVerifyIntegrity } from '../hooks/useSignatures';
import { useProfile } from '../hooks/useProfile';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'EntryDetail'>;

export function EntryDetailScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const entryId = route.params.entryId;

  const { data: entry } = useEntry(entryId);
  const { data: signature } = useSignatureForEntry(entryId);
  const { data: integrity } = useVerifyIntegrity(entryId);
  const { data: amendment } = useAmendmentForEntry(entryId);
  const { data: profile } = useProfile();
  const deleteEntry = useDeleteEntry();

  if (!entry) return null;

  const isSigned = entry.status === 'signed';
  const isDraft = entry.status === 'draft';

  const handleDelete = () => {
    Alert.alert('Delete entry', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteEntry.mutateAsync(entryId);
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[typography.h1, { color: colors.textPrimary }]}>Entry detail</Text>
          <Badge status={entry.status} />
        </View>

        {isSigned && integrity && !integrity.valid && (
          <Banner variant="error" message="Integrity check failed — this entry may have been modified after signing." />
        )}
        {isSigned && integrity && integrity.valid && (
          <Banner variant="info" message="Integrity: verified" />
        )}
        {entry.amends_entry_id && (
          <Banner variant="info" message={`Amends entry from ${entry.date}`}
            actionLabel="View original"
            onAction={() => navigation.push('EntryDetail', { entryId: entry.amends_entry_id! })} />
        )}
        {amendment && (
          <Banner variant="info" message="This entry has been amended"
            actionLabel="View amendment"
            onAction={() => navigation.push('EntryDetail', { entryId: amendment.id })} />
        )}

        <Card style={{ gap: spacing.sm }}>
          <Text style={[typography.h2, { color: colors.textPrimary }]}>When & where</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Date: {entry.date}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Site: {entry.site}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Employer: {entry.employer}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Client: {entry.client}</Text>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <Text style={[typography.h2, { color: colors.textPrimary }]}>Work</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Hours: {entry.work_hours}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Level: {entry.tech_level_snapshot}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Type: {entry.work_types.join(', ')}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{entry.description}</Text>
        </Card>

        {entry.amendment_reason && (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.h2, { color: colors.statusAmended }]}>Amendment reason</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>{entry.amendment_reason}</Text>
          </Card>
        )}

        {signature && (
          <Card style={{ gap: spacing.sm }}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>Signature</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Supervisor: {signature.supervisor_name}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Cert #: {signature.supervisor_cert_number}</Text>
            <Text style={[typography.bodySmall, { color: colors.textTertiary }]}>Signed: {signature.signed_at}</Text>
            <Image source={{ uri: signature.signature_png_path }} style={{ width: '100%', height: 100, resizeMode: 'contain' }} />
            <Text style={[typography.caption, { color: colors.textTertiary }]}>SHA-256: {signature.entry_hash}</Text>
          </Card>
        )}

        <View style={{ gap: spacing.sm, marginTop: spacing.base }}>
          {isDraft && (
            <>
              <Button title="Edit" onPress={() => navigation.navigate('EntryForm', { entryId: entry.id })} />
              <Button title="Request supervisor signature" variant="secondary"
                onPress={() => navigation.navigate('Signature', { entryId: entry.id })} />
              <Button title="Delete" variant="ghost" onPress={handleDelete} />
            </>
          )}
          {isSigned && !amendment && (
            <Button title="Amend this entry" variant="secondary"
              onPress={() => navigation.navigate('EntryForm', { amendEntryId: entry.id })} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
