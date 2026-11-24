/** The exact text an admin signs to request a curator run (free, no transaction). */
export function curatorRunMessage(ts: number, dryRun = false): string {
  return `Oracle Markets: run the curator now${dryRun ? " as a dry-run preview" : ""} (ts ${ts})`;
}

/** What /api/admin/curator/run reports (Redis curator:run-request / curator:run-status). */
export interface CuratorRunState {
  pending: { by: string; at: string; dryRun?: boolean } | null;
  last: {
    by: string;
    requestedAt: string;
    preview?: boolean;
    triggeredAt?: string;
    error?: string;
  } | null;
}
