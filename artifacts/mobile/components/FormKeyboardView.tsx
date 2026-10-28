import React from 'react';
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native';

/** The route-addition default: native Android resize, iOS padding. A second
 * Android height subtraction makes short dialogs jump differently from forms. */
export function FormKeyboardView(props: Omit<KeyboardAvoidingViewProps, 'behavior'>) {
  return <KeyboardAvoidingView {...props} behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS !== 'web' && props.enabled !== false} />;
}
