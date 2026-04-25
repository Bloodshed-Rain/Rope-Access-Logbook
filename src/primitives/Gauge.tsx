import React from 'react';
import { Text, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  G,
  Line,
  Circle,
  Filter,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
} from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export interface GaugeProps {
  value: number;
  target: number;
  // Center text. Defaults render the numerator / denominator pair.
  centerNumberOverride?: string;
  unitLabel?: string;
}

const VIEW_W = 320;
const VIEW_H = 200;
const CX = 160;
const CY = 170;
const ARC_R = 120;
const ARC_LEN = Math.PI * ARC_R; // 376.99
const TICK_COUNT = 41;
const TICK_R_OUTER = 132;
const TICK_R_INNER = 122;
const TICK_R_MAJOR = 116;

function buildTicks(majorColor: string, minorColor: string) {
  const ticks: React.ReactElement[] = [];
  const startAngle = 180;
  const sweep = 180;
  for (let i = 0; i < TICK_COUNT; i++) {
    const t = i / (TICK_COUNT - 1);
    const angle = startAngle + t * sweep;
    const rad = (angle * Math.PI) / 180;
    const isMajor = i % 5 === 0;
    const r1 = isMajor ? TICK_R_MAJOR : TICK_R_INNER;
    const r2 = TICK_R_OUTER;
    const x1 = CX + Math.cos(rad) * r1;
    const y1 = CY + Math.sin(rad) * r1;
    const x2 = CX + Math.cos(rad) * r2;
    const y2 = CY + Math.sin(rad) * r2;
    ticks.push(
      <Line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={isMajor ? majorColor : minorColor}
        strokeWidth={isMajor ? 1.4 : 1}
      />,
    );
  }
  return ticks;
}

// Semi-circular gauge: background arc + gradient progress arc with glow filter,
// tick ring, needle, and a center number stack rendered as a sibling overlay
// (RN doesn't support arbitrary HTML text inside SVG cleanly, so we layout the
// center stack outside the SVG and absolutely-position it).
export function Gauge({ value, target, centerNumberOverride, unitLabel = 'LOGGED HOURS' }: GaugeProps) {
  const { colors } = useTheme();
  const pct = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const dashOffset = ARC_LEN * (1 - pct);
  const needleRot = (pct - 0.5) * 180;

  const numerator = centerNumberOverride ?? (Number.isInteger(value) ? value.toString() : value.toFixed(1));

  return (
    <View style={{ width: '100%', alignItems: 'center', position: 'relative' }}>
      <Svg width="100%" height={VIEW_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Defs>
          <LinearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor={colors.accentDeep} />
            <Stop offset="100%" stopColor={colors.accentHot} />
          </LinearGradient>
          <Filter id="arcGlow">
            <FeGaussianBlur stdDeviation="3" />
            <FeMerge>
              <FeMergeNode />
              <FeMergeNode in="SourceGraphic" />
            </FeMerge>
          </Filter>
        </Defs>

        {/* Tick ring */}
        <G>{buildTicks(colors.inkSecondary, colors.edgeHi)}</G>

        {/* Background arc */}
        <Path
          d={`M ${CX - ARC_R} ${CY} A ${ARC_R} ${ARC_R} 0 1 1 ${CX + ARC_R} ${CY}`}
          fill="none"
          stroke={colors.bgRaised}
          strokeWidth={14}
        />

        {/* Progress arc */}
        <Path
          d={`M ${CX - ARC_R} ${CY} A ${ARC_R} ${ARC_R} 0 1 1 ${CX + ARC_R} ${CY}`}
          fill="none"
          stroke="url(#arcGrad)"
          strokeWidth={14}
          strokeDasharray={ARC_LEN}
          strokeDashoffset={dashOffset}
        />

        {/* Needle */}
        <G transform={`rotate(${needleRot} ${CX} ${CY})`}>
          <Line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={60}
            stroke={colors.accentHot}
            strokeWidth={2}
          />
          <Circle cx={CX} cy={CY} r={6} fill={colors.bgBase} stroke={colors.accentBase} strokeWidth={1.5} />
          <Circle cx={CX} cy={CY} r={2} fill={colors.accentHot} />
        </G>
      </Svg>

      {/* Center stack — overlays the SVG. Keep aligned with VIEW_H/CY. */}
      <View
        style={{
          position: 'absolute',
          top: VIEW_H * 0.45,
          left: 0,
          right: 0,
          alignItems: 'center',
          pointerEvents: 'none' as any,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_800ExtraBold',
              fontSize: 46,
              color: colors.inkPrimary,
              letterSpacing: -0.92,
              lineHeight: 46,
            }}
          >
            {numerator}
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 20,
              color: colors.inkTertiary,
              marginHorizontal: 4,
            }}
          >
            /
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              fontSize: 20,
              color: colors.inkTertiary,
            }}
          >
            {target}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: 'Michroma_400Regular',
            fontSize: 9,
            letterSpacing: 2.5,
            color: colors.inkTertiary,
            marginTop: 4,
          }}
        >
          {unitLabel}
        </Text>
      </View>
    </View>
  );
}
