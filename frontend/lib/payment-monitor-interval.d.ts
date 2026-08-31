export const DEFAULT_INTERVAL_MS: number;
export const INTERVALS_MS: Readonly<Record<string, number>>;
export function paymentMonitorInterval(status?: string | null): number;
