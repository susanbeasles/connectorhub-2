// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [
        // The worker build resolves tslib through its "node" condition, which yields a
        // UMD module with no ESM default — @peculiar/x509 then destructures `__extends`
        // off `undefined` at module init and every SSR request 500s. Pin the ESM build.
        { find: /^tslib$/, replacement: fileURLToPath(new URL("./node_modules/tslib/tslib.es6.mjs", import.meta.url)) },
        // React Email's parser needs entities v4.5.0; nested v7 copies dropped ./lib/*.
        {
          find: /^entities\/lib\/decode\.js$/,
          replacement: fileURLToPath(new URL("./node_modules/entities/lib/decode.js", import.meta.url)),
        },
        {
          find: /^entities\/lib\/encode\.js$/,
          replacement: fileURLToPath(new URL("./node_modules/entities/lib/encode.js", import.meta.url)),
        },
        {
          find: /^entities$/,
          replacement: fileURLToPath(new URL("./node_modules/entities", import.meta.url)),
        },
      ],
    },
  },
});

