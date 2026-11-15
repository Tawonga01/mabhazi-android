/** Shared Mabhazi presentation, adapted from the supplied capture designs.
 * Values describe appearance only; route eligibility and evidence stay in their models. */
export const ui = {
  color: { navy: '#102744', surface: '#F4F6F9', paper: '#FFFFFF', orange: '#FF9B45', ink: '#172D46', muted: '#617186', border: '#D7E0E9', soft: '#E8EDF3', selected: '#DFE9F5', danger: '#B4233B' },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, section: 24 },
  radius: { control: 12, group: 16, sheet: 26 },
  type: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
  touch: 44,
} as const;
