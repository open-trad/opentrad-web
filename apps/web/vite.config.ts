import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { PRODUCTION_CSP, shouldInjectProductionCsp } from "./src/security/contentSecurityPolicy";

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH ?? "/",
  worker: { format: "es" },
  plugins: [
    react(),
    ...(shouldInjectProductionCsp(command)
      ? [
          {
            name: "opentrad-production-csp",
            transformIndexHtml: {
              order: "pre" as const,
              handler: () => [
                {
                  tag: "meta",
                  attrs: { "http-equiv": "Content-Security-Policy", content: PRODUCTION_CSP },
                  injectTo: "head-prepend" as const,
                },
              ],
            },
          },
        ]
      : []),
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: "./src/test/setup.ts",
  },
}));
