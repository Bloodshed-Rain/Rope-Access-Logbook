// src/primitives/KeyboardDoneAccessory.tsx
//
// iOS-only "Done" bar that floats above the keyboard. Mounted once at the
// app root (App.tsx). Any TextInput / Input / Textarea that passes
// `inputAccessoryViewID={KEYBOARD_DONE_ID}` shows this bar when focused.
//
// Why: iOS's number-pad and decimal-pad keyboards have no built-in Return
// or Done key, and multi-line text fields treat Return as a newline. Both
// leave users tapping outside the input to dismiss, which is discoverable
// only after you've used the app for a while. A persistent Done bar makes
// the dismiss action obvious and one-tap.
//
// Android: returns null. Android's system back button already dismisses
// the keyboard, and InputAccessoryView is iOS-only.

import React from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const KEYBOARD_DONE_ID = 'ralb-keyboard-done';

export function KeyboardDoneAccessory() {
  const { colors, spacing, typography, borders } = useTheme();
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.sm,
          backgroundColor: colors.bgMuted,
          borderTopWidth: borders.hair,
          borderTopColor: colors.divider,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          onPress={() => Keyboard.dismiss()}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[typography.bodyMed, { color: colors.accentPrimary }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}
