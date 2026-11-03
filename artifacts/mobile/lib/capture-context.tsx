import React, { useContext } from 'react';
import type { CaptureRequest } from './contribution-moments';

export const CaptureEntryContext = React.createContext<{
  open(request: CaptureRequest): boolean; isOpen: boolean; revision: number;
} | null>(null);
export function useCaptureEntry() {
  const entry = useContext(CaptureEntryContext);
  if (!entry) throw new Error('Capture entry must be inside the shared capture host.');
  return entry;
}
export const CaptureFrameContext = React.createContext<{
  overlay: boolean;
  register(close: (() => void) | undefined, busy: boolean): () => void;
} | null>(null);
