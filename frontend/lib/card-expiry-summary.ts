import { getTimeRemaining } from './utils';

export function expirySummary(expiresAt: string | Date): string {
  return getTimeRemaining(expiresAt);
}
