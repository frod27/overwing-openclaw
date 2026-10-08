import { builtinModules } from "node:module";
import { defineConfig } from "tsup";

// One file, dependencies inlined, so OpenClaw's managed install has nothing to resolve.
// The OpenClaw SDK itself stays external: the host provides it.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node22",
  splitting: false,
  noExternal: [/^(?!openclaw)/],
  external: [...builtinModules.flatMap((m) => [m, `node:${m}`]), /^openclaw/],
  banner: { js: `import { createRequire as __overwing_createRequire } from 'node:module'; const require = __overwing_createRequire(import.meta.url);` },
});
