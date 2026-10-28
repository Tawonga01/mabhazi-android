import React from 'react';
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native';
import { KeyboardAvoidingView as ModalKeyboardAvoidingView } from 'react-native-keyboard-controller';

type Props = Omit<KeyboardAvoidingViewProps, 'behavior' | 'contentContainerStyle'> & { modal?: boolean };
/** Android modal windows are adjustNothing while KeyboardProvider is active.
 * Use the installed controller's IME events there; native screen resize is a
 * separate path. Callers supply the modal frame's parent top offset. */
export function FormKeyboardView({ modal = false, ...props }: Props) {
  if (Platform.OS === 'android' && modal) {
    return <ModalKeyboardAvoidingView {...props} behavior="padding" enabled={props.enabled !== false} />;
  }
  return <KeyboardAvoidingView {...props} behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS !== 'web' && props.enabled !== false} />;
}
