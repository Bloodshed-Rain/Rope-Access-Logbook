import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Screen, Card, SectionHeader, RopeDivider } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntries } from '../hooks/useEntries';

export function AnalyticsScreen() {
  const { colors, spacing, typography } = useTheme();
  const { data: entries } = useEntries();

  const stats = useMemo(() => {
    if (!entries) return null;
    const signed = entries.filter(e => e.status === 'signed');
    
    let total = 0;
    const byType: Record<string, number> = {};
    const byEmployer: Record<string, number> = {};

    signed.forEach(e => {
      total += e.work_hours;
      const emp = e.employer.trim() || 'Unknown';
      byEmployer[emp] = (byEmployer[emp] ?? 0) + e.work_hours;
      
      if (e.work_types.length === 0) {
        byType['unknown'] = (byType['unknown'] ?? 0) + e.work_hours;
      } else {
        e.work_types.forEach(wt => {
          byType[wt] = (byType[wt] ?? 0) + e.work_hours;
        });
      }
    });

    const sortAndMap = (record: Record<string, number>) => 
      Object.entries(record)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5) // top 5
        .map(([label, val]) => ({ label, value: val, percent: total > 0 ? (val / total) : 0 }));

    return { total, types: sortAndMap(byType), employers: sortAndMap(byEmployer) };
  }, [entries]);

  if (!stats) return <Screen><View /></Screen>;

  return (
    <Screen topDivider>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.md, paddingHorizontal: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Analytics & Reporting</Text>

        <Card accent="navy" style={{ gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.xl }}>
          <Text style={[typography.stencil, { color: colors.textSecondary }]}>TOTAL SIGNED HOURS</Text>
          <Text style={[typography.display, { fontSize: 56, color: colors.accent }]}>{stats.total.toFixed(0)}</Text>
        </Card>

        <SectionHeader label="TOP WORK TYPES" />
        <Card accent="orange" style={{ gap: spacing.md }}>
          {stats.types.length === 0 && <Text style={{ color: colors.textSecondary }}>No work types recorded.</Text>}
          {stats.types.map(t => (
            <View key={t.label} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[typography.body, { color: colors.textPrimary, textTransform: 'capitalize' }]}>{t.label.replace('_', ' ')}</Text>
                <Text style={[typography.body, { color: colors.textSecondary }]}>{t.value.toFixed(1)} hrs</Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.slateLight }]}>
                <View style={[styles.bar, { width: `${t.percent * 100}%`, backgroundColor: colors.accent }]} />
              </View>
            </View>
          ))}
        </Card>

        <SectionHeader label="TOP EMPLOYERS" />
        <Card accent="orange" style={{ gap: spacing.md, marginBottom: spacing.xl }}>
          {stats.employers.length === 0 && <Text style={{ color: colors.textSecondary }}>No employers recorded.</Text>}
          {stats.employers.map(e => (
            <View key={e.label} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[typography.body, { color: colors.textPrimary }]} numberOfLines={1}>{e.label}</Text>
                <Text style={[typography.body, { color: colors.textSecondary }]}>{e.value.toFixed(1)} hrs</Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.slateLight }]}>
                <View style={[styles.bar, { width: `${e.percent * 100}%`, backgroundColor: colors.navy }]} />
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, width: '100%', overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
});
