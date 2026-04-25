import React from 'react';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';

export interface RivetProps {
  size?: number;
}

// 5x5 (default) machined rivet — radial gradient inner highlight + outline ring.
// Used at panel corners and standalone for industrial chrome.
export function Rivet({ size = 5 }: RivetProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 5 5">
      <Defs>
        <RadialGradient id="rivetGrad" cx="30%" cy="30%" r="80%">
          <Stop offset="0%" stopColor="#4a5260" />
          <Stop offset="100%" stopColor="#1a1e25" />
        </RadialGradient>
      </Defs>
      <Circle cx="2.5" cy="2.5" r="2.5" fill="url(#rivetGrad)" />
      <Circle cx="2.5" cy="2.5" r="2.4" fill="none" stroke="#0a0b0d" strokeWidth="0.5" />
    </Svg>
  );
}
