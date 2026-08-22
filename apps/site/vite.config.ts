/**
 * The landing page is one static document, so this config is deliberately bare.
 *
 * `base: "./"` keeps the built asset URLs relative, because the page is served
 * from a path (`ziahamza.com/parle`) rather than from a domain root, and an
 * absolute `/assets/…` would 404 there while working perfectly in `vite dev`.
 */
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  /*
   * The port comes from the environment when there is one.
   *
   * A hardcoded port ignores whatever a local HTTPS proxy assigned, so the
   * proxy sits in front of nothing and the browser gets a connection refused
   * on a URL that looks correct. 5173 is only the fallback for a bare
   * `vite dev`.
   */
  server: {
    port: Number(process.env.PORT ?? 5173),
    host: process.env.HOST ?? "127.0.0.1",
    strictPort: process.env.PORT !== undefined
  }
})
