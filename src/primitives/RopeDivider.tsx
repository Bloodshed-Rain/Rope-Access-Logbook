import React from 'react';
import { ViewStyle, View } from 'react-native';
import Svg, { Path, Defs, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export interface RopeDividerProps {
  color?: string;
  height?: number;
  opacity?: number;
  style?: ViewStyle;
}

export function RopeDivider({ color, height = 6, opacity = 0.35, style }: RopeDividerProps) {
  const { colors } = useTheme();
  const strokeColor = color ?? colors.ropeTan;

  return (
    <View style={[{ width: '100%', height, opacity }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="rope-pattern" width="20" height={height} patternUnits="userSpaceOnUse">
            {/* Strand 1 */}
            <Path
              d={`M0,${height * 0.2} Q5,0 10,${height * 0.5} T20,${height * 0.8}`}
              stroke={strokeColor}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            {/* Strand 2 */}
            <Path
              d={`M0,${height * 0.8} Q5,${height} 10,${height * 0.5} T20,${height * 0.2}`}
              stroke={strokeColor}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#rope-pattern)" />
      </Svg>
    </View>
  );
}
