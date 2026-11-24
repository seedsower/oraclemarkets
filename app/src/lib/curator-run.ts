/** The exact text an admin signs to request a curator run (free, no transaction). */
export function curatorRunMessage(ts: number): string {
  return `Oracle Markets: run the curator now (ts ${ts})`;
}

/** What /api/admin/curator/run reports (Redis curator:run-request / curator:run-status). */
export interface CuratorRunState {
  pending: { by: string; at: string } | null;
  last: { by: string; requestedAt: string; triggeredAt?: string; error?: string } | null;
}
