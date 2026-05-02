// src/screens/NotificationsScreen.tsx
// Placeholder reached from the Today-screen bell. E3 rebuilds this with
// rich rows, mark-all-read, and per-kind icons; for now we just list the
// kind + timestamp so the bell has a destination.

import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Screen } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useNotificationCenter } from '../hooks/useNotificationCenter';

export function NotificationsScreen() {
  const { colors, spacing, typography } = useTheme();
  const { items } = useNotificationCenter();

  if (items.length === 0) {
    return (
      <Screen topDivider>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: spacing.xxl,
          }}
        >
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            No notifications yet
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen topDivider>
      <ScrollView
        contentContainerStyle={{
          paddingVertical: spacing.md,
          gap: spacing.sm,
        }}
      >
        {items.map((n) => (
          <View
            key={n.id}
            style={{
              paddingVertical: spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.divider,
            }}
          >
            <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
              {n.kind}
            </Text>
            <Text
              style={[
                typography.caption,
                { color: colors.textSecondary, marginTop: spacing.xs },
              ]}
            >
              {n.created_at}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
