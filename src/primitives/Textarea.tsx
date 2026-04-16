import React from 'react';
import { Input } from './Input';
import { TextInputProps } from 'react-native';

interface TextareaProps extends TextInputProps { label: string; error?: string; }

export function Textarea({ style, ...props }: TextareaProps) {
  return <Input {...props} multiline numberOfLines={4} textAlignVertical="top" style={[{ minHeight: 100 }, style]} />;
}
