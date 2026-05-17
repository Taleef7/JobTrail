import { Colors } from '../theme/colors';

/**
 * Returns a color for a given job status.
 */
export function statusColor(status: string): string {
  switch (status) {
    case 'draft': return Colors.statusDraft;
    case 'scheduled': return Colors.statusScheduled;
    case 'in_progress': return Colors.statusInProgress;
    case 'completed': return Colors.statusCompleted;
    case 'archived': return Colors.statusArchived;
    default: return Colors.textTertiary;
  }
}

/**
 * Formats an ISO date string for display.
 * @param iso - ISO date string
 * @param style - 'short' for list cards (date + time), 'long' for report headers (full date)
 */
export function formatDate(iso: string, style: 'short' | 'long' = 'short'): string {
  try {
    if (style === 'long') {
      return new Date(iso).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    }
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}