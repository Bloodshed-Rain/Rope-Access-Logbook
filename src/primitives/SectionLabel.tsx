// SectionLabel is the canonical name in the new design system. It re-exports
// the existing SectionHeader implementation under its new API (index, label).
import React from 'react';
import { SectionHeader } from './SectionHeader';

export interface SectionLabelProps {
  index?: string;
  label: string;
  right?: React.ReactNode;
}

export function SectionLabel({ index, label, right }: SectionLabelProps) {
  return <SectionHeader num={index} label={label} right={right} />;
}
