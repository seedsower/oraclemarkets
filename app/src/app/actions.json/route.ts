import type { ActionsJson } from "@solana/actions";
import { ACTION_HEADERS, actionOptions } from "@/lib/server/actions/common";

/**
 * Solana Actions discovery, served from the domain root (`/actions.json`):
 * maps the public market / group page URLs to their Action APIs, so a market
 * link posted on X unfurls as a Blink for wallets that support them.
 */
export function GET() {
  const body: ActionsJson = {
    rules: [
      { pathPattern: "/market/*", apiPath: "/api/actions/market/*" },
      { pathPattern: "/group/*", apiPath: "/api/actions/group/*" },
    ],
  };
  return Response.json(body, { headers: ACTION_HEADERS });
}

export const OPTIONS = actionOptions;
