// src/screens/SignatureScreen.tsx
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { Screen, Button, Input, Card, Banner, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry } from '../hooks/useEntries';
import { useSignEntry } from '../hooks/useSignatures';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { useBackup } from '../hooks/useBackup';
import { useReadOnly } from '../hooks/useSubscription';
import { saveSignaturePng } from '../utils/fileStorage';
import { generateId } from '../utils/uuid';
import { RootStackParamList } from '../navigation/RootNavigator';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createExportService } from '../services/exportService';
import { sha256 } from '../utils/hash';
import { APP_VERSION } from '../constants';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SigRoute = RouteProp<RootStackParamList, 'Signature'>;

export function SignatureScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<SigRoute>();
  const entryId = route.params.entryId;
  const { data: entry } = useEntry(entryId);
  const db = getClient();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const backup = useBackup({
    db,
    cloud,
    fs,
    hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
    appVersion: APP_VERSION,
  });
  const signEntry = useSignEntry({ afterSign: () => backup.mutate() });
  const { showPostSigningNudge } = useBackupReminder();
  const sigRef = useRef<any>(null);
  const readOnly = useReadOnly();

  const [supervisorName, setSupervisorName] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  if (!entry) return null;

  const missingEntryFields: string[] = [];
  if (!entry.date_from) missingEntryFields.push('start date');
  if (!entry.date_to) missingEntryFields.push('end date');
  if (!entry.work_hours || entry.work_hours <= 0) missingEntryFields.push('hours');
  if (!entry.description?.trim()) missingEntryFields.push('description');
  const entryReady = missingEntryFields.length === 0;

  const canSign = entryReady && supervisorName.trim() && certNumber.trim() && signatureData;

  const handleSign = async () => {
    if (!signatureData) return;
    // Lapsed subscription — bounce to Paywall before writing the
    // signature row. The drawn signature is held in local state so the
    // user can come back and submit after renewing.
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    setSigning(true);

    try {
      const sigId = generateId();
      const sigPath = await saveSignaturePng(signatureData.replace('data:image/png;base64,', ''), sigId);

      let gpsLat: number | undefined;
      let gpsLon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          gpsLat = loc.coords.latitude;
          gpsLon = loc.coords.longitude;
        }
      } catch {}

      await signEntry.mutateAsync({
        entry_id: entryId,
        supervisor_name: supervisorName.trim(),
        supervisor_cert_number: certNumber.trim(),
        signature_png_path: sigPath,
        device_id: Device.modelName ?? 'unknown',
        gps_lat: gpsLat,
        gps_lon: gpsLon,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (showPostSigningNudge) {
        Alert.alert('Back up your logbook', 'Back up your logbook to keep it safe.', [{ text: 'OK' }]);
      }

      navigation.goBack();
      navigation.goBack();
    } catch (err: any) {
      if (err?.message === 'missing_required') {
        Alert.alert(
          'Entry is incomplete',
          'Fill in dates, hours, and a description on the entry before signing.',
        );
      } else {
        Alert.alert('Signing failed', err.message);
      }
    } finally {
      setSigning(false);
    }
  };

  return (
    <Screen topDivider>
      <ScrollView scrollEnabled={scrollEnabled} contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.md, paddingHorizontal: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Local Signature</Text>

        {!entryReady && (
          <Banner
            variant="warning"
            message={`Add ${missingEntryFields.join(', ')} to the entry before signing.`}
            actionLabel="Edit entry"
            onAction={() => navigation.navigate('EntryForm', { entryId: entry.id })}
          />
        )}

        <SectionHeader label="ENTRY SUMMARY" />
        <Card accent="navy">
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.date_from === entry.date_to ? entry.date_from : `${entry.date_from} → ${entry.date_to}`} — {entry.site}</Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.work_hours}h · {entry.employer}</Text>
            <Text style={[typography.label, { color: colors.textSecondary }]}>{entry.description}</Text>
          </View>
        </Card>

        <SectionHeader label="SUPERVISOR DETAILS" />
        <Card accent="orange">
          <Input label="Supervisor name" value={supervisorName} onChangeText={setSupervisorName} placeholder="Full name" />
          <Input
            label="SPRAT Level III cert number"
            value={certNumber}
            onChangeText={(t) => setCertNumber(t.replace(/\D/g, '').slice(0, 5))}
            placeholder="Ex: 54321"
            keyboardType="number-pad"
            maxLength={5}
          />
        </Card>

        <SectionHeader label="SIGNATURE" />
        <Card accent="orange" style={{ gap: spacing.xs }}>
          <View
            onTouchStart={() => setScrollEnabled(false)}
            onTouchEnd={() => setScrollEnabled(true)}
            onTouchCancel={() => setScrollEnabled(true)}
            style={{ borderWidth: 2, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', height: 200, backgroundColor: '#ffffff' }}
          >
            <SignatureCanvas
              ref={sigRef}
              onOK={(sig) => setSignatureData(sig)}
              onEnd={() => sigRef.current?.readSignature()}
              onClear={() => setSignatureData(null)}
              autoClear={false}
              descriptionText=""
              webStyle={`.m-signature-pad { box-shadow: none; border: none; } .m-signature-pad--body { border: none; background-color: #ffffff; } .m-signature-pad--footer { display: none; }`}
            />
          </View>
          <Button title="Clear signature" variant="ghost" onPress={() => { sigRef.current?.clearSignature(); setSignatureData(null); }} />
        </Card>

        <Button title="CONFIRM & SIGN" variant="danger" onPress={handleSign} disabled={!canSign} loading={signing} style={{ marginTop: spacing.md }} haptic />
      </ScrollView>
    </Screen>
  );
}
