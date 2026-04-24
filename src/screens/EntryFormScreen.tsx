// src/screens/EntryFormScreen.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { copyPhotoToAppStorage } from '../utils/fileStorage';
import { Screen, Button, Input, Textarea, Chip, Banner, Card, ListRow, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useEntry, useCreateEntry, useUpdateEntry, useCreateAmendment } from '../hooks/useEntries';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useSignRequests } from '../hooks/useSignRequests';
import { useAuthSession } from '../hooks/useAuthSession';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';
import { WorkType } from '../types';
import { generateId } from '../utils/uuid';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type FormRoute = RouteProp<RootStackParamList, 'EntryForm'>;

const WORK_TYPES: { value: WorkType; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'ndt', label: 'NDT' },
  { value: 'welding', label: 'Welding' },
  { value: 'painting', label: 'Painting' },
  { value: 'window_cleaning', label: 'Window Cleaning' },
  { value: 'rescue', label: 'Rescue' },
  { value: 'training', label: 'Training' },
  { value: 'rigging', label: 'Rigging' },
  { value: 'other', label: 'Other' },
];

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fromISODate(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

export function EntryFormScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<FormRoute>();
  const { data: profile } = useProfile();

  const editId = route.params?.entryId;
  const amendId = route.params?.amendEntryId;
  const { data: existingEntry } = useEntry(editId ?? amendId ?? '');

  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const createAmendment = useCreateAmendment();

  const isEdit = !!editId;
  const isAmend = !!amendId;
  // Stable temporary ID used for photo filenames when creating a new entry.
  // This avoids all photos being named 'new_0.jpg', 'new_1.jpg', etc.
  const tempEntryId = React.useMemo(() => generateId(), []);

  const today = toISODate(new Date());
  const [dateFrom, setDateFrom] = useState<string>(today);
  const [dateTo, setDateTo] = useState<string>(today);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [employer, setEmployer] = useState(profile?.default_employer ?? '');
  const [site, setSite] = useState('');
  const [client, setClient] = useState('');
  const [description, setDescription] = useState('');
  const [workHours, setWorkHours] = useState('');
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [otherWorkDescription, setOtherWorkDescription] = useState('');
  const [equipmentNotes, setEquipmentNotes] = useState('');
  const [weather, setWeather] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const isLeavingIntentionally = useRef(false);

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const conns = useSupervisorConnections({ db, cloud });
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const { session } = useAuthSession(cloud);

  const accepted = (conns.query.data ?? []).filter(
    (c) => c.tech_user_id === session?.user_id && c.status === 'accepted' && c.supervisor_user_id,
  );

  useEffect(() => {
    if (existingEntry) {
      setDateFrom(existingEntry.date_from);
      setDateTo(existingEntry.date_to);
      setEmployer(existingEntry.employer);
      setSite(existingEntry.site);
      setClient(existingEntry.client);
      setDescription(existingEntry.description);
      setWorkHours(existingEntry.work_hours > 0 ? String(existingEntry.work_hours) : '');
      setWorkTypes(existingEntry.work_types);
      setOtherWorkDescription(existingEntry.other_work_description ?? '');
      setEquipmentNotes(existingEntry.equipment_notes ?? '');
      setWeather(existingEntry.weather ?? '');
      setPhotoPaths(existingEntry.photo_paths ?? []);
    }
  }, [existingEntry]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isLeavingIntentionally.current || !isDirty) { return; }
      e.preventDefault();
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: "Don't leave", style: 'cancel', onPress: () => {} },
          { text: 'Discard', style: 'destructive', onPress: () => {
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            } 
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, isDirty]);

  const markDirty = () => !isDirty && setIsDirty(true);

  const handleAddPhoto = async () => {
    markDirty();
    if (photoPaths.length >= 5) {
      Alert.alert('Maximum photos', 'You can attach up to 5 photos per entry.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const saved = await copyPhotoToAppStorage(result.assets[0].uri, editId ?? tempEntryId, photoPaths.length);
      setPhotoPaths((prev) => [...prev, saved]);
    }
  };

  const toggleWorkType = (wt: WorkType) => {
    markDirty();
    setWorkTypes((prev) => (prev.includes(wt) ? prev.filter((t) => t !== wt) : [...prev, wt]));
  };

  const onChangeFrom = (_e: DateTimePickerEvent, d?: Date) => {
    markDirty();
    if (Platform.OS !== 'ios') setShowFromPicker(false);
    if (d) {
      const iso = toISODate(d);
      setDateFrom(iso);
      if (iso > dateTo) setDateTo(iso);
    }
  };

  const onChangeTo = (_e: DateTimePickerEvent, d?: Date) => {
    markDirty();
    if (Platform.OS !== 'ios') setShowToPicker(false);
    if (d) setDateTo(toISODate(d));
  };

  const canSubmit = !isAmend || !!amendmentReason.trim();

  const handleSave = async () => {
    if (!profile) return;
    const hours = workHours.trim() === '' ? 0 : parseFloat(workHours);
    if (workHours.trim() !== '' && (isNaN(hours) || hours < 0)) {
      Alert.alert('Invalid hours', 'Please enter a valid number of work hours.');
      return;
    }

    const otherText = workTypes.includes('other') && otherWorkDescription.trim()
      ? otherWorkDescription.trim()
      : null;

    if (isAmend && amendId) {
      await createAmendment.mutateAsync({ entryId: amendId, reason: amendmentReason.trim(), techLevel: profile.level });
    } else if (isEdit && editId) {
      await updateEntry.mutateAsync({
        id: editId,
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || null, weather: weather || null, photo_paths: photoPaths,
        },
      });
    } else {
      await createEntry.mutateAsync({
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || undefined, weather: weather || undefined,
          photo_paths: photoPaths.length > 0 ? photoPaths : undefined,
        },
        techLevel: profile.level,
      });
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    isLeavingIntentionally.current = true;
    navigation.goBack();
  };

  const saveEntry = async (): Promise<string> => {
    if (!profile) throw new Error('profile_not_loaded');
    const hours = workHours.trim() === '' ? 0 : parseFloat(workHours);
    if (workHours.trim() !== '' && (isNaN(hours) || hours < 0)) {
      throw new Error('invalid_hours');
    }

    const otherText = workTypes.includes('other') && otherWorkDescription.trim()
      ? otherWorkDescription.trim()
      : null;

    if (isEdit && editId) {
      await updateEntry.mutateAsync({
        id: editId,
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || null, weather: weather || null, photo_paths: photoPaths,
        },
      });
      return editId;
    } else {
      const created = await createEntry.mutateAsync({
        input: {
          date_from: dateFrom, date_to: dateTo, employer, site, client, description,
          work_hours: hours, work_types: workTypes, other_work_description: otherText,
          equipment_notes: equipmentNotes || undefined, weather: weather || undefined,
          photo_paths: photoPaths.length > 0 ? photoPaths : undefined,
        },
        techLevel: profile.level,
      });
      return typeof created === 'string' ? created : (created as any).id;
    }
  };

  const title = isAmend ? 'AMEND ENTRY' : isEdit ? 'EDIT ENTRY' : 'NEW ENTRY';
  const spanDays = Math.max(
    1,
    Math.round(
      (fromISODate(dateTo).getTime() - fromISODate(dateFrom).getTime()) / (24 * 60 * 60 * 1000),
    ) + 1,
  );
  const hoursLabel = spanDays > 1
    ? `Hours worked across this ${spanDays}-day span`
    : 'Hours worked';
  const hoursPlaceholder = spanDays > 1 ? String(spanDays * 8) : '8';

  const needed = (
    <Text style={[typography.caption, { color: colors.accent }]}>needed to sign</Text>
  );

  return (
    <Screen topDivider>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl, paddingTop: spacing.md }}>
          <Text style={[typography.h1, { color: colors.textPrimary, paddingHorizontal: spacing.base }]}>{title}</Text>

          {isAmend && (
            <View style={{ paddingHorizontal: spacing.base }}>
              <Textarea label="Amendment reason (required)" value={amendmentReason}
                onChangeText={(t) => { markDirty(); setAmendmentReason(t); }} placeholder="Why is this entry being amended?" />
            </View>
          )}

          <View style={{ paddingHorizontal: spacing.base }}>
            <SectionHeader label="WHEN & WHERE" />
            <Card accent="navy" style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>From</Text>
                <Pressable
                  onPress={() => setShowFromPicker(true)}
                  style={{
                    borderWidth: 2, borderColor: colors.border, borderRadius: 10,
                    paddingHorizontal: spacing.base, paddingVertical: spacing.base,
                    backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center',
                  }}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>{dateFrom}</Text>
                </Pressable>
                {needed}
                {showFromPicker && (
                  <DateTimePicker
                    value={fromISODate(dateFrom)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onChangeFrom}
                  />
                )}
              </View>

              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>To</Text>
                <Pressable
                  onPress={() => setShowToPicker(true)}
                  style={{
                    borderWidth: 2, borderColor: colors.border, borderRadius: 10,
                    paddingHorizontal: spacing.base, paddingVertical: spacing.base,
                    backgroundColor: colors.surface, minHeight: 48, justifyContent: 'center',
                  }}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>{dateTo}</Text>
                </Pressable>
                {needed}
                {showToPicker && (
                  <DateTimePicker
                    value={fromISODate(dateTo)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={fromISODate(dateFrom)}
                    onChange={onChangeTo}
                  />
                )}
              </View>

              <Input label="Employer" value={employer} onChangeText={(t) => { markDirty(); setEmployer(t); }} />
              <Input label="Job site / location" value={site} onChangeText={(t) => { markDirty(); setSite(t); }} />
              <Input label="Client / project" value={client} onChangeText={(t) => { markDirty(); setClient(t); }} />
            </Card>
          </View>

          <View style={{ paddingHorizontal: spacing.base }}>
            <SectionHeader label="WORK" />
            <Card accent="navy" style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <Input
                  label={hoursLabel}
                  value={workHours}
                  onChangeText={(t) => { markDirty(); setWorkHours(t); }}
                  keyboardType="decimal-pad"
                  placeholder={hoursPlaceholder}
                />
                {needed}
              </View>

              <View style={{ gap: spacing.xs }}>
                <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Type of work</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {WORK_TYPES.map((wt) => (
                    <Chip key={wt.value} label={wt.label} selected={workTypes.includes(wt.value)} onPress={() => toggleWorkType(wt.value)} />
                  ))}
                </View>
                {workTypes.includes('other') && (
                  <Input
                    label="Describe the other work"
                    value={otherWorkDescription}
                    onChangeText={(t) => { markDirty(); setOtherWorkDescription(t); }}
                    placeholder="e.g. paint stripping"
                  />
                )}
              </View>

              <View style={{ gap: spacing.xs }}>
                <Textarea label="Description of work" value={description} onChangeText={(t) => { markDirty(); setDescription(t); }} placeholder="What did you do?" />
                {needed}
              </View>
            </Card>
          </View>

          <View style={{ paddingHorizontal: spacing.base }}>
            <SectionHeader label="OPTIONAL" />
            <Card accent="navy" style={{ gap: spacing.md }}>
              <Input label="Equipment / rigging notes" value={equipmentNotes} onChangeText={(t) => { markDirty(); setEquipmentNotes(t); }} />
              <Input label="Weather / conditions" value={weather} onChangeText={(t) => { markDirty(); setWeather(t); }} />
              <Button title={`Add photo (${photoPaths.length}/5)`} variant="secondary" onPress={handleAddPhoto} />
            </Card>
          </View>

          <View style={{ paddingHorizontal: spacing.base }}>
            {isEdit && existingEntry && existingEntry.status === 'draft' && (
              existingEntry.pending_sign_request_id ? (
                <Banner
                  variant="info"
                  message="Awaiting signature"
                  actionLabel="Withdraw"
                  onAction={async () => {
                    try {
                      await signReqs.withdraw.mutateAsync(existingEntry.pending_sign_request_id!);
                    } catch (e: any) {
                      Alert.alert('Could not withdraw', e.message);
                    }
                  }}
                />
              ) : (
                <>
                  {(() => {
                    const entryIsComplete =
                      !!dateFrom && !!dateTo && parseFloat(workHours || '0') > 0 && !!description.trim();
                    return (
                      <Button
                        title="REQUEST SIGNATURE"
                        variant="secondary"
                        onPress={() => setShowPicker(true)}
                        disabled={!entryIsComplete || accepted.length === 0}
                      />
                    );
                  })()}
                  {accepted.length === 0 && (
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>
                      Add a supervisor in your profile before requesting a signature.
                    </Text>
                  )}
                  {showPicker && (
                    <Card style={{ marginTop: spacing.md }} accent="orange">
                      <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
                        Pick a supervisor
                      </Text>
                      {accepted.map((c) => (
                        <ListRow
                          key={c.id}
                          title={c.supervisor_display_name ?? c.invited_email}
                          subtitle="Tap to send"
                          onPress={async () => {
                            try {
                              const entryId = await saveEntry();
                              await signReqs.send.mutateAsync({
                                entry_id: entryId,
                                connection_id: c.id,
                                supervisor_user_id: c.supervisor_user_id!,
                              });
                              setShowPicker(false);
                              isLeavingIntentionally.current = true;
                              navigation.goBack();
                            } catch (e: any) {
                              if (e.message === 'invalid_hours') {
                                Alert.alert('Invalid hours', 'Please enter a valid number of work hours.');
                              } else {
                                Alert.alert('Could not send', e.message);
                              }
                            }
                          }}
                        />
                      ))}
                      <View style={{ height: spacing.xs }} />
                      <Button title="Cancel" variant="ghost" onPress={() => setShowPicker(false)} />
                    </Card>
                  )}
                </>
              )
            )}

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <Button title={isEdit ? 'SAVE CHANGES' : 'SAVE AS DRAFT'} onPress={handleSave} disabled={!canSubmit}
                loading={createEntry.isPending || updateEntry.isPending || createAmendment.isPending}
                style={{ flex: 1 }} haptic />
              <Button title="CANCEL" variant="ghost" onPress={() => { isLeavingIntentionally.current = true; navigation.goBack(); }} style={{ flex: 1 }} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
