// src/screens/SignatureScreen.tsx
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { Screen, Button, Input, Card } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry } from '../hooks/useEntries';
import { useSignEntry } from '../hooks/useSignatures';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { saveSignaturePng } from '../utils/fileStorage';
import { generateId } from '../utils/uuid';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SigRoute = RouteProp<RootStackParamList, 'Signature'>;

export function SignatureScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<SigRoute>();
  const entryId = route.params.entryId;
  const { data: entry } = useEntry(entryId);
  const signEntry = useSignEntry();
  const { showPostSigningNudge } = useBackupReminder();
  const sigRef = useRef<any>(null);

  const [supervisorName, setSupervisorName] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  if (!entry) return null;

  const canSign = supervisorName.trim() && certNumber.trim() && signatureData;

  const handleSign = async () => {
    if (!signatureData) return;
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
      Alert.alert('Signing failed', err.message);
    } finally {
      setSigning(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Supervisor signature</Text>

        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Entry summary</Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.date} — {entry.site}</Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.work_hours}h · {entry.employer}</Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{entry.description}</Text>
          </View>
        </Card>

        <Input label="Supervisor name" value={supervisorName} onChangeText={setSupervisorName} placeholder="Full name" />
        <Input label="SPRAT Level III cert number" value={certNumber} onChangeText={setCertNumber} placeholder="L3-XXXXX" />

        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Signature</Text>
          <View style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', height: 200 }}>
            <SignatureCanvas
              ref={sigRef}
              onOK={(sig) => setSignatureData(sig)}
              onEnd={() => sigRef.current?.readSignature()}
              onClear={() => setSignatureData(null)}
              autoClear={false}
              descriptionText=""
              webStyle={`.m-signature-pad { box-shadow: none; border: none; } .m-signature-pad--body { border: none; } .m-signature-pad--footer { display: none; }`}
            />
          </View>
          <Button title="Clear signature" variant="ghost" onPress={() => { sigRef.current?.clearSignature(); setSignatureData(null); }} />
        </View>

        <Button title="Confirm & sign" onPress={handleSign} disabled={!canSign} loading={signing} style={{ marginTop: spacing.lg }} />
      </ScrollView>
    </Screen>
  );
}
