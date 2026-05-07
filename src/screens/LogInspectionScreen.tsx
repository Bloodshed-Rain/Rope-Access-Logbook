// src/screens/LogInspectionScreen.tsx
//
// Captures a single inspection: date, result (3-segment), inspector name,
// notes. Pass / pass_with_concerns advance next_inspection_due. Fail flips
// the parent gear item to retired in the same transaction.

import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, Textarea, useToast, SegmentedControl, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useGearItem, useLogInspection } from '../hooks/useGear';
import { useReadOnly } from '../hooks/useSubscription';
import { GearInspectionResult } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'LogInspection'>;

export function LogInspectionScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { gearId } = route.params;
  const { data: item, isLoading } = useGearItem(gearId);
  const logInspection = useLogInspection();
  const toast = useToast();
  const readOnly = useReadOnly();

  const today = new Date().toISOString().slice(0, 10);
  const [inspectedOn, setInspectedOn] = useState(today);
  const [result, setResult] = useState<GearInspectionResult>('pass');
  const [inspector, setInspector] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (readOnly) navigation.replace('Paywall');
  }, [readOnly, navigation]);

  if (isLoading || !item) return <LoadingSpinner fullScreen label="Loading gear" />;

  const handleSubmit = () => {
    // Authoritative gate. The mount-time useEffect redirect is racy against
    // a status flip that arrives after first paint; gating the actual
    // mutation call site is what guarantees no write fires while lapsed.
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    logInspection.mutate(
      {
        gear_id: item.id,
        inspected_on: inspectedOn,
        result,
        inspector_name: inspector.trim() || null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          if (result === 'fail') {
            toast.show({ message: 'Inspection logged. Item retired.', variant: 'warn' });
          } else {
            toast.show({ message: 'Inspection logged.', variant: 'ok' });
          }
          navigation.goBack();
        },
        onError: (e) => toast.show({ message: (e as Error).message, variant: 'err' }),
      },
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.base, gap: spacing.base, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>Log inspection</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {item.name}
          </Text>
        </View>

        <Input
          label="Inspected on"
          hint="YYYY-MM-DD"
          value={inspectedOn}
          onChangeText={setInspectedOn}
        />

        <View>
          <Text
            style={[typography.label, { color: colors.textPrimary, marginBottom: spacing.xs }]}
          >
            Result
          </Text>
          <SegmentedControl
            options={[
              { value: 'pass', label: 'Pass' },
              { value: 'pass_with_concerns', label: 'Concerns' },
              { value: 'fail', label: 'Fail' },
            ]}
            value={result}
            onChange={(v) => setResult(v as GearInspectionResult)}
          />
          {result === 'fail' && (
            <Text
              style={[
                typography.caption,
                { color: colors.statusErr, marginTop: spacing.xs },
              ]}
            >
              A failed inspection retires this item. Its history stays on the logbook.
            </Text>
          )}
        </View>

        <Input
          label="Inspector name (optional)"
          value={inspector}
          onChangeText={setInspector}
          autoCapitalize="words"
        />

        <Textarea
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="What was checked, what looked good, what raised concern."
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title="Save"
              variant="primary"
              onPress={handleSubmit}
              disabled={logInspection.isPending || readOnly}
              loading={logInspection.isPending}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
