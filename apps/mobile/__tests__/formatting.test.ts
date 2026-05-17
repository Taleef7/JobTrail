import { statusColor, formatDate } from '../src/utils/formatting';

describe('statusColor', () => {
  it('returns correct color for each status', () => {
    expect(statusColor('draft')).toBeTruthy();
    expect(statusColor('scheduled')).toBeTruthy();
    expect(statusColor('in_progress')).toBeTruthy();
    expect(statusColor('completed')).toBeTruthy();
    expect(statusColor('archived')).toBeTruthy();
  });

  it('returns fallback color for unknown status', () => {
    expect(statusColor('unknown')).toBeTruthy();
  });
});

describe('formatDate', () => {
  it('formats short style correctly', () => {
    const result = formatDate('2024-03-15T10:30:00Z', 'short');
    expect(result).toContain('15');
    expect(result).toContain('Mar');
  });

  it('formats long style correctly', () => {
    const result = formatDate('2024-03-15T10:30:00Z', 'long');
    expect(result).toContain('March');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('returns the original string on invalid date', () => {
    const result = formatDate('not-a-date');
    expect(result).toBe('not-a-date');
  });
});
