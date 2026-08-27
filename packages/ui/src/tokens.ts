/**
 * Ported one-to-one from the Flutter app's `lib/core/constants/app_colors.dart`
 * so web and mobile read as one product (§11.1). Do not add new colors here
 * without adding them to `app_colors.dart` first — this file follows, it
 * doesn't lead.
 */

export const colors = {
  // Brand greens
  primary: "#1A7A4C",
  primaryLight: "#4CAF7E",
  primaryDark: "#0D4F31",
  primarySurface: "#E8F5EE",

  // Gold accents
  gold: "#F5A623",
  goldLight: "#FFD166",
  goldDark: "#CC8800",

  // Neutrals
  white: "#FFFFFF",
  offWhite: "#F8FAF9",
  surface: "#F0FAF5",

  // Dark mode
  darkBackground: "#091410",
  darkSurface: "#0F1F18",
  darkCard: "#162B20",
  darkBorder: "#1E3B2A",

  // Text
  textDark: "#0D2119",
  textMedium: "#3A5E4B",
  textMuted: "#7A9D8C",
  textLight: "#F0FAF5",
  textDisabled: "#B0C8BE",

  // Status
  success: "#10B981",
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",
} as const;

export const gradients = {
  primary: `linear-gradient(135deg, ${colors.primary}, ${colors.primaryDark})`,
  gold: `linear-gradient(135deg, ${colors.goldLight}, ${colors.gold})`,
  creditCard: `linear-gradient(135deg, ${colors.primary} 0%, #0A3D23 50%, ${colors.primaryDark} 100%)`,
  darkCard: `linear-gradient(135deg, ${colors.darkCard}, ${colors.darkSurface})`,
} as const;

export const radii = {
  sm: "12px",
  md: "14px",
  lg: "16px",
  xl: "24px",
} as const;

export const fontFamily = {
  sans: '"Inter", system-ui, -apple-system, sans-serif',
} as const;
