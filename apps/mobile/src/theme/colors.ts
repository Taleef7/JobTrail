// Theme constants for JobTrail
export const Colors = {
  primary: '#2563EB',
  primaryLight: '#3B82F6',
  primaryDark: '#1D4ED8',
  secondary: '#059669',
  secondaryLight: '#10B981',
  accent: '#F59E0B',
  danger: '#DC2626',
  dangerLight: '#EF4444',

  background: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceSecondary: '#F3F4F6',

  text: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',

  border: '#E5E7EB',
  borderDark: '#D1D5DB',

  // Status colors
  statusDraft: '#6B7280',
  statusScheduled: '#2563EB',
  statusInProgress: '#F59E0B',
  statusCompleted: '#059669',
  statusArchived: '#9CA3AF',

  // Sync status colors
  syncLocalOnly: '#9CA3AF',
  syncPending: '#F59E0B',
  syncSyncing: '#3B82F6',
  syncSynced: '#059669',
  syncFailed: '#DC2626',
  syncConflict: '#7C3AED',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Typography = {
  fontSize: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

// Elevation (shadow) tokens
export const Elevation = {
  none: { shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  low: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2 },
  medium: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4 },
  high: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8 },
} as const;