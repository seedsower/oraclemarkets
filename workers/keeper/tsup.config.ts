import { defineConfig } from "tsup";

// CommonJS on purpose: `@anchor-lang/core` is CJS, and the SDK's ESM build
// can't be imported by raw Node ESM (named `BN` import) — see packages/sdk/llms.txt.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
});
