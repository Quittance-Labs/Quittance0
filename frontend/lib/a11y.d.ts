export interface StatusText {
  label: string;
  description: string;
}

export type AnnouncementKind = 'status' | 'error';

export declare const INVOICE_STATUS_TEXT: Readonly<Record<string, StatusText>>;
export declare const UNKNOWN_STATUS_TEXT: StatusText;

export function statusText(status?: string | null): StatusText;
export function statusBadgeLabel(status?: string | null): string;
export function statusAnnouncement(status?: string | null): string;

export declare const MAIN_CONTENT_ID: string;
export declare const PAYMENT_RESULT_ID: string;
export declare const CREATED_INVOICE_ID: string;
export declare const DASHBOARD_RESULTS_ID: string;

export function announcementPoliteness(kind: AnnouncementKind): 'polite' | 'assertive';
export function announcementRole(kind: AnnouncementKind): 'status' | 'alert';
export function describeAmount(amount: number | string, assetCode?: string | null): string;
export function unavailableReason(available: boolean, reason: string): string | null;
