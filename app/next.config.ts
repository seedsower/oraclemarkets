import path from "node:path";
import type { NextConfig } from "next";

// The app lives in a pnpm workspace (it imports `@pm-amm/sdk` from
// `packages/sdk`), so file tracing and Turbopack must see the repo root.
const workspaceRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // Self-contained `server.js` + traced node_modules — what the Railway
  // Dockerfile ships (see /Dockerfile and RAILWAY.md).
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  serverExternalPackages: ["@anchor-lang/core"],
};

export default nextConfig;
