import { ui } from './ui';
const colors = {
  light: {
    text: ui.color.ink, tint: ui.color.orange,
    background: ui.color.surface, foreground: ui.color.ink,
    card: ui.color.paper, cardForeground: ui.color.ink,
    primary: ui.color.navy, primaryForeground: '#FFFFFF',
    secondary: ui.color.soft, secondaryForeground: ui.color.navy,
    muted: ui.color.soft, mutedForeground: ui.color.muted,
    accent: ui.color.orange, accentForeground: ui.color.navy,
    destructive: ui.color.danger, destructiveForeground: '#FFFFFF',
    border: ui.color.border, input: ui.color.border,
  }, radius: ui.radius.control,
};
export default colors;
