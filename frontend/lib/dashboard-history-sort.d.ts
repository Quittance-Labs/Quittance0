export function dashboardHistorySortKey(
  invoice?: Record<string, unknown> | null,
  field?: 'createdAt' | 'amount' | 'status' | 'expiresAt',
  direction?: 'asc' | 'desc'
): number | string;
