import React from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Rect, Pattern, Defs } from 'react-native-svg';

export interface NoiseTextureProps {
  opacity?: number;
  style?: ViewStyle;
}

// Subtle 1-bit machined-metal texture overlay. Drop into a parent <View> with
// `position: 'relative'`; this absolute-positions to fill the parent. The
// pattern is generated at render time as a tiled scatter of 1px dots — not
// truly stochastic but visually close enough at small opacity.
export function NoiseTexture({ opacity = 0.02, style }: NoiseTextureProps) {
  return (
    <View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity },
        style,
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="noise" x={0} y={0} width={4} height={4} patternUnits="userSpaceOnUse">
            <Rect x="0" y="0" width="1" height="1" fill="#ffffff" />
            <Rect x="3" y="2" width="1" height="1" fill="#ffffff" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#noise)" />
      </Svg>
    </View>
  );
}
