import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Screen, Card, Button, Banner, Input } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSignRequests } from '../hooks/useSignRequests';
import { useProfile } from '../hooks/useProfile';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignRequestDetail'>;

export function SignRequestDetailScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { data: profile } = useProfile();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const [showCanvas, setShowCanvas] = useState(false);
  const [signing, setSigning] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const sigRef = useRef<any>(null);

  const req = (signReqs.query.data ?? []).find((r) => r.id === route.params.requestId);
  if (!req || !profile) return null;
  const entry = req.entry_payload;

  const handleSign = async (png_base64: string) => {
    setSigning(true);
    try {
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {}
      await signReqs.sign.mutateAsync({
        request_id: req.id,
        png_base64: png_base64.replace('data:image/png;base64,', ''),
        supervisor_name: profile.full_name,
        supervisor_cert_number: profile.supervisor_cert_number ?? '',
        device_id: Device.modelName ?? 'unknown',
        gps_lat: lat,
        gps_lon: lon,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not sign', e.message);
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    try {
      await signReqs.decline.mutateAsync({ id: req.id, reason: declineReason.trim() });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not decline', e.message);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, padding: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Sign request</Text>
        <Banner variant="info" message={`Requested at ${new Date(req.created_at).toLocaleString()}`} />

        <Card>
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>
            {entry.date_from === entry.date_to ? entry.date_from : `${entry.date_from} → ${entry.date_to}`}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.site} · {entry.client}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.employer}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.work_hours}h · Level {entry.tech_level_snapshot}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            Work types: {entry.work_types.join(', ')}
          </Text>
          {entry.other_work_description && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Other: {entry.other_work_description}
            </Text>
          )}
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm }]}>
            {entry.description}
          </Text>
          {entry.equipment_notes && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              Equipment: {entry.equipment_notes}
            </Text>
          )}
          {entry.weather && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Weather: {entry.weather}
            </Text>
          )}
        </Card>

        {entry.photo_paths.length > 0 && (
          <Card>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
              Photos (images reside on the tech's device; upload/download of the request's copies is not yet wired up)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {entry.photo_paths.map((p, i) => (
                <Image key={i} source={{ uri: p }} style={{ width: 100, height: 100, borderRadius: 6 }} />
              ))}
            </View>
          </Card>
        )}

        {req.status !== 'pending' && (
          <Banner
            variant="info"
            message={`Status: ${req.status}${req.decline_reason ? ` — ${req.decline_reason}` : ''}`}
          />
        )}

        {req.status === 'pending' && !showCanvas && !declineMode && (
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <Button title="Sign" onPress={() => setShowCanvas(true)} />
            <Button title="Decline" variant="ghost" onPress={() => setDeclineMode(true)} />
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
        )}

        {declineMode && (
          <Card>
            <Input
              label="Decline reason"
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Optional reason (the tech will see this)"
              maxLength={200}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={{ minHeight: 100 }}
            />
            <View style={{ height: spacing.xs }} />
            <Button title="Decline request" onPress={handleDecline} />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setDeclineMode(false);
                setDeclineReason('');
              }}
            />
          </Card>
        )}

        {showCanvas && (
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Your signature</Text>
            <View style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', height: 200 }}>
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => handleSign(sig)}
                autoClear={false}
                descriptionText=""
                webStyle={`.m-signature-pad{box-shadow:none;border:none}.m-signature-pad--body{border:none}.m-signature-pad--footer{display:none}`}
              />
            </View>
            <Button title="Confirm signature" onPress={() => sigRef.current?.readSignature()} loading={signing} />
            <Button title="Clear" variant="ghost" onPress={() => sigRef.current?.clearSignature()} />
            <Button title="Back" variant="ghost" onPress={() => setShowCanvas(false)} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
