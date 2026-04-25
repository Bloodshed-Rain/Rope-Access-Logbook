import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Rivet } from './Rivet';

export interface PanelHeader {
  label: string;
  tag?: string;
}

export interface PanelProps {
  header?: PanelHeader;
  rivets?: boolean;        // default true
  cornerMark?: boolean;    // default true — small L-shape stencil glyph top-right
  style?: ViewStyle;
  children: React.ReactNode;
}

// Heavy industrial container — gradient face (approximated via solid bgPanel
// with top-edge highlight), rivets at corners, optional stencil header strip.
export function Panel({
  header,
  rivets = true,
  cornerMark = true,
  style,
  children,
}: PanelProps) {
  const { colors, spacing, typography, borders } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.bgPanel,
          borderTopWidth: borders.hair,
          borderTopColor: colors.edgeHi,
          borderRightWidth: borders.hair,
          borderRightColor: colors.edgeBase,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.edgeBase,
          borderLeftWidth: borders.hair,
          borderLeftColor: colors.edgeBase,
          position: 'relative',
        },
        style,
      ]}
    >
      {rivets && (
        <>
          <View style={{ position: 'absolute', top: 5, left: 5 }}>
            <Rivet />
          </View>
          <View style={{ position: 'absolute', top: 5, right: 5 }}>
            <Rivet />
          </View>
          <View style={{ position: 'absolute', bottom: 5, left: 5 }}>
            <Rivet />
          </View>
          <View style={{ position: 'absolute', bottom: 5, right: 5 }}>
            <Rivet />
          </View>
        </>
      )}
      {cornerMark && (
        <View
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 16,
            height: 16,
            borderTopWidth: 1.5,
            borderTopColor: colors.edgeBright,
            borderRightWidth: 1.5,
            borderRightColor: colors.edgeBright,
            opacity: 0.5,
          }}
        />
      )}
      {header && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingTop: spacing.s3,
            paddingHorizontal: spacing.s4,
          }}
        >
          <Text style={[typography.stencilSm, { color: colors.inkTertiary, letterSpacing: 1.8 }]}>
            {header.label}
          </Text>
          {header.tag && (
            <Text
              style={{
                fontFamily: 'JetBrainsMono_700Bold',
                fontSize: 10,
                color: colors.accentBase,
                letterSpacing: 1.0,
              }}
            >
              {header.tag}
            </Text>
          )}
        </View>
      )}
      {children}
    </View>
  );
}
