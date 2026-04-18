// src/screens/EntryFormScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { copyPhotoToAppStorage } from '../utils/fileStorage';
import { Screen, Button, Input, Textarea, Chip } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useEntry, useCreateEntry, useUpdateEntry, useCreateAmendment } from '../hooks/useEntries';
import { RootStackParamList } from '../navigation/RootNavigator';
import { WorkType } from '../types';

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

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [employer, setEmployer] = useState(profile?.default_employer ?? '');
  const [site, setSite] = useState('');
  const [client, setClient] = useState('');
  const [description, setDescription] = useState('');
  const [workHours, setWorkHours] = useState('');
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [equipmentNotes, setEquipmentNotes] = useState('');
  const [weather, setWeather] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);

  useEffect(() => {
    if (existingEntry) {
      setDate(existingEntry.date_from);
      setEmployer(existingEntry.employer);
      setSite(existingEntry.site);
      setClient(existingEntry.client);
      setDescription(existingEntry.description);
      setWorkHours(String(existingEntry.work_hours));
      setWorkTypes(existingEntry.work_types);
      setEquipmentNotes(existingEntry.equipment_notes ?? '');
      setWeather(existingEntry.weather ?? '');
      setPhotoPaths(existingEntry.photo_paths ?? []);
    }
  }, [existingEntry]);

  const handleAddPhoto = async () => {
    if (photoPaths.length >= 5) {
      Alert.alert('Maximum photos', 'You can attach up to 5 photos per entry.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const saved = await copyPhotoToAppStorage(result.assets[0].uri, editId ?? 'new', photoPaths.length);
      setPhotoPaths((prev) => [...prev, saved]);
    }
  };

  const toggleWorkType = (wt: WorkType) => {
    setWorkTypes((prev) => (prev.includes(wt) ? prev.filter((t) => t !== wt) : [...prev, wt]));
  };

  const canSubmit = date && employer && site && client && description && workHours && workTypes.length > 0
    && (!isAmend || amendmentReason.trim());

  const handleSave = async () => {
    if (!profile) return;
    const hours = parseFloat(workHours);
    if (isNaN(hours) || hours <= 0) {
      Alert.alert('Invalid hours', 'Please enter a valid number of work hours.');
      return;
    }

    if (isAmend && amendId) {
      await createAmendment.mutateAsync({ entryId: amendId, reason: amendmentReason.trim(), techLevel: profile.level });
    } else if (isEdit && editId) {
      await updateEntry.mutateAsync({
        id: editId,
        input: { date_from: date, date_to: date, employer, site, client, description, work_hours: hours, work_types: workTypes,
          equipment_notes: equipmentNotes || null, weather: weather || null, photo_paths: photoPaths },
      });
    } else {
      await createEntry.mutateAsync({
        input: { date_from: date, date_to: date, employer, site, client, description, work_hours: hours, work_types: workTypes,
          equipment_notes: equipmentNotes || undefined, weather: weather || undefined,
          photo_paths: photoPaths.length > 0 ? photoPaths : undefined },
        techLevel: profile.level,
      });
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  };

  const title = isAmend ? 'Amend entry' : isEdit ? 'Edit entry' : 'New entry';

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
          <Text style={[typography.h1, { color: colors.textPrimary }]}>{title}</Text>

          {isAmend && (
            <Textarea label="Amendment reason (required)" value={amendmentReason}
              onChangeText={setAmendmentReason} placeholder="Why is this entry being amended?" />
          )}

          <Text style={[typography.h2, { color: colors.textSecondary }]}>When & where</Text>
          <Input label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          <Input label="Employer" value={employer} onChangeText={setEmployer} />
          <Input label="Job site / location" value={site} onChangeText={setSite} />
          <Input label="Client / project" value={client} onChangeText={setClient} />

          <Text style={[typography.h2, { color: colors.textSecondary }]}>Work</Text>
          <Input label="Work hours" value={workHours} onChangeText={setWorkHours} keyboardType="decimal-pad" placeholder="8" />

          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Type of work</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {WORK_TYPES.map((wt) => (
                <Chip key={wt.value} label={wt.label} selected={workTypes.includes(wt.value)} onPress={() => toggleWorkType(wt.value)} />
              ))}
            </View>
          </View>

          <Textarea label="Description of work" value={description} onChangeText={setDescription} placeholder="What did you do today?" />

          <Text style={[typography.h2, { color: colors.textSecondary }]}>Optional</Text>
          <Input label="Equipment / rigging notes" value={equipmentNotes} onChangeText={setEquipmentNotes} />
          <Input label="Weather / conditions" value={weather} onChangeText={setWeather} />
          <Button title={`Add photo (${photoPaths.length}/5)`} variant="secondary" onPress={handleAddPhoto} />

          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
            <Button title="Save as draft" onPress={handleSave} disabled={!canSubmit}
              loading={createEntry.isPending || updateEntry.isPending || createAmendment.isPending}
              style={{ flex: 1 }} />
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
