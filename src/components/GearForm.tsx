// src/components/GearForm.tsx
//
// Shared add/edit form for a gear item. Owns the local form state, runs the
// catalog autocomplete on the make/model field, and emits the validated
// CreateGearInput / UpdateGearInput via onSubmit. The screens (AddGear /
// EditGear) handle navigation, mutation, and toast feedback.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Input, Textarea, Button } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useGearCatalog } from '../hooks/useGear';
import { CreateGearInput, GearCatalogEntry, GearCategory, GearItem } from '../types';

const CATEGORIES: { value: GearCategory; label: string }[] = [
  { value: 'harness', label: 'Harness' },
  { value: 'helmet', label: 'Helmet' },
  { value: 'rope', label: 'Rope' },
  { value: 'lanyard', label: 'Lanyard' },
  { value: 'sling', label: 'Sling' },
  { value: 'descender', label: 'Descender' },
  { value: 'ascender', label: 'Ascender' },
  { value: 'carabiner', label: 'Carabiner' },
  { value: 'pulley', label: 'Pulley' },
  { value: 'other', label: 'Other' },
];

export interface GearFormProps {
  initial?: GearItem;
  submitLabel: string;
  submitting?: boolean;
  /** Lapsed-subscription read-only flag — disables Save so the user sees the
   * gate visually rather than tapping a button that bounces them away. */
  readOnly?: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateGearInput) => void;
}

export function GearForm({ initial, submitLabel, submitting, readOnly, onCancel, onSubmit }: GearFormProps) {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const { data: catalog } = useGearCatalog();

  const [category, setCategory] = useState<GearCategory>(initial?.category ?? 'harness');
  const [makeModel, setMakeModel] = useState(
    [initial?.manufacturer, initial?.model].filter(Boolean).join(' '),
  );
  // Once a catalog row is tapped, manufacturer/model snap to the row values
  // so freeform edits to the combined input don't desync the parts.
  const [manufacturer, setManufacturer] = useState<string | null>(initial?.manufacturer ?? null);
  const [model, setModel] = useState<string | null>(initial?.model ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [serial, setSerial] = useState(initial?.serial_number ?? '');
  const [manufactureDate, setManufactureDate] = useState(initial?.manufacture_date ?? '');
  const [firstUseDate, setFirstUseDate] = useState(initial?.first_use_date ?? '');
  const [intervalMonths, setIntervalMonths] = useState(
    String(initial?.inspection_interval_months ?? 6),
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const matches = useMemo<GearCatalogEntry[]>(() => {
    const q = makeModel.trim().toLowerCase();
    if (q.length < 2 || !catalog?.length) return [];
    // Filter to the currently selected category so picking "harness" + "pet"
    // only shows Petzl harnesses, not their descenders or pulleys. The
    // catalog's category column is authoritative for this.
    return catalog
      .filter((c) => c.category === category)
      .filter((c) => `${c.manufacturer} ${c.model}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [makeModel, catalog, category]);

  const showSuggestions =
    matches.length > 0 &&
    `${manufacturer ?? ''} ${model ?? ''}`.trim() !== makeModel.trim();

  const handlePickCatalog = (entry: GearCatalogEntry) => {
    setManufacturer(entry.manufacturer);
    setModel(entry.model);
    setMakeModel(`${entry.manufacturer} ${entry.model}`);
    if (!initial) setCategory(entry.category);
  };

  const intervalNum = Math.max(1, Math.min(24, parseInt(intervalMonths, 10) || 6));

  const canSubmit = !submitting && !readOnly && intervalNum >= 1;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // If the combined input no longer matches the snapped parts, treat it as
    // a freeform brand/model: split on the first space so something useful
    // lands in both columns. The catalog match is cosmetic — the DB is fine
    // with either.
    let mfg: string | null = manufacturer;
    let mdl: string | null = model;
    const mm = makeModel.trim();
    if (mm && (manufacturer == null || model == null || `${manufacturer} ${model}` !== mm)) {
      const idx = mm.indexOf(' ');
      if (idx > 0) {
        mfg = mm.slice(0, idx);
        mdl = mm.slice(idx + 1);
      } else {
        mfg = mm;
        mdl = null;
      }
    }

    onSubmit({
      name: name.trim() || undefined,
      category,
      manufacturer: mfg ?? null,
      model: mdl ?? null,
      serial_number: serial.trim() || null,
      manufacture_date: manufactureDate.trim() || null,
      first_use_date: firstUseDate.trim() || null,
      inspection_interval_months: intervalNum,
      notes: notes.trim() || null,
    });
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.base, gap: spacing.base, paddingBottom: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Category */}
      <View>
        <Text style={[typography.label, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
          Category
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {CATEGORIES.map((c) => {
            const selected = c.value === category;
            return (
              <Pressable
                key={c.value}
                onPress={() => setCategory(c.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  borderWidth: borders.hair,
                  borderColor: selected ? colors.accentPrimary : colors.border,
                  backgroundColor: selected ? colors.accentPrimary : colors.bgSurface,
                }}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: selected ? colors.textInverse : colors.textPrimary },
                  ]}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Make / model with autocomplete */}
      <View>
        <Input
          label="Make / model"
          value={makeModel}
          onChangeText={(v) => {
            setMakeModel(v);
            setManufacturer(null);
            setModel(null);
          }}
          placeholder="e.g. Petzl Avao Bod"
          autoCapitalize="words"
          autoCorrect={false}
        />
        {showSuggestions && (
          <View
            style={{
              marginTop: spacing.xs,
              borderRadius: radii.md,
              borderWidth: borders.hair,
              borderColor: colors.border,
              backgroundColor: colors.bgSurface,
              overflow: 'hidden',
            }}
          >
            {matches.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => handlePickCatalog(m)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
                })}
              >
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {m.manufacturer} {m.model}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  {m.category}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Input
        label="Custom name (optional)"
        value={name}
        onChangeText={setName}
        placeholder="Defaults to manufacturer + model"
      />

      <Input
        label="Serial number (optional)"
        value={serial}
        onChangeText={setSerial}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <Input
        label="Manufacture date (optional)"
        hint="YYYY-MM-DD"
        value={manufactureDate}
        onChangeText={setManufactureDate}
        placeholder="2026-01-15"
        keyboardType="numbers-and-punctuation"
      />

      <Input
        label="First use date (optional)"
        hint="YYYY-MM-DD — drives next inspection due"
        value={firstUseDate}
        onChangeText={setFirstUseDate}
        placeholder="2026-02-01"
        keyboardType="numbers-and-punctuation"
      />

      <Input
        label="Inspection interval"
        hint="months (1–24)"
        value={intervalMonths}
        onChangeText={setIntervalMonths}
        keyboardType="number-pad"
      />

      <Textarea
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything worth knowing — purchase context, modifications, retirement plan."
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="ghost" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            title={submitLabel}
            variant="primary"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={!!submitting}
          />
        </View>
      </View>
    </ScrollView>
  );
}
