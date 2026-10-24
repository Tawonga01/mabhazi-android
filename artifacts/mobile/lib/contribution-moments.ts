import type { OwnRouteContext } from './actual-journey-model';
import type { V2City } from '@workspace/api-client-react';

export interface RoutePrefill {
  origin: V2City | null;
  destination: V2City | null;
  originQuery: string;
  destinationQuery: string;
}
export type CaptureRequest =
  | { kind: 'route'; entrySurface: 'contribute_tab' | 'search_empty'; prefill?: RoutePrefill }
  | { kind: 'journey'; entrySurface: 'contribute_tab'; route?: never }
  | { kind: 'journey'; entrySurface: 'own_contribution'; route: OwnRouteContext };
export type SearchViewState = 'idle' | 'loading' | 'error' | 'safety_error' | 'safety_loading' | 'hidden' | 'empty' | 'results';

/** Invitation eligibility uses successful public results, never a failed/blocked [] fallback. */
export function searchViewState(input: {
  searched: boolean; loading: boolean; succeeded: boolean; failed: boolean;
  safetyLoading: boolean; safetyFailed: boolean; total: number; visible: number;
}): SearchViewState {
  if (!input.searched) return 'idle';
  if (input.loading || !input.succeeded && !input.failed) return 'loading';
  if (input.failed) return 'error';
  if (input.safetyFailed) return 'safety_error';
  if (input.safetyLoading) return 'safety_loading';
  if (input.total > 0 && input.visible === 0) return 'hidden';
  return input.total === 0 ? 'empty' : 'results';
}

/** Names guard against stale picker state; they never resolve a new city identity. */
export function searchRoutePrefill(originText: string, destinationText: string, origin: V2City | null, destination: V2City | null): RoutePrefill {
  return {
    origin: origin?.name === originText ? { ...origin } : null,
    destination: destination?.name === destinationText ? { ...destination } : null,
    originQuery: originText.trim(), destinationQuery: destinationText.trim(),
  };
}
