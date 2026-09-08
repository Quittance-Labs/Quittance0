export function invoiceSharePath(id: string): string {
  return `/pay/${encodeURIComponent(id)}`;
}
