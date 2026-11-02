// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import pagefindLean from "./integrations/pagefind-lean.mjs";

const PAGES_BASE = "/karlsruhe-oparl-viewer/";
const runningInCi =
  process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isDev = process.env.NODE_ENV === "development" && !runningInCi;
const skipPagefind = ["1", "true", "yes"].includes(
  (process.env.SKIP_PAGEFIND ?? "").toLowerCase(),
);

/**
 * Routes that must stay out of the sitemap. `/vorlage/` holds the 13.7k legacy
 * redirect stubs (they already carry `noindex` + a canonical), and the
 * client-only pages have no server-rendered content worth indexing.
 */
const EXCLUDED_FROM_SITEMAP = [
  `${PAGES_BASE}vorlage/`,
  `${PAGES_BASE}suche`,
  `${PAGES_BASE}gespeicherte-suchen`,
];

const integrations = [
  sitemap({
    filter: (page) => {
      const { pathname } = new URL(page);
      if (/\/vorlagen(?:\d{4})?(?:\.html)?$/.test(pathname)) return false;
      return !EXCLUDED_FROM_SITEMAP.some((prefix) =>
        pathname.startsWith(prefix),
      );
    },
    // Keep sitemap URLs byte-identical to the `<link rel="canonical">` the
    // pages emit: `build.format: "file"` would otherwise advertise `.html`.
    serialize: (item) => ({
      ...item,
      url: item.url.replace(/index\.html$/, "").replace(/\.html$/, ""),
    }),
  }),
];

if (!skipPagefind) {
  integrations.push(pagefindLean());
}

// https://astro.build/config
export default defineConfig({
  site: "https://maxliesegang.github.io",
  base: isDev ? "/" : PAGES_BASE,
  build: {
    format: "file",
  },
  integrations,
  vite: {
    server: {
      watch: {
        // The data checkout (~93k files) and the build output are read, never
        // edited during development. Watching them exhausts the Linux inotify
        // limit (ENOSPC) and makes the dev server heavy on small machines.
        ignored: ["**/syndication-data/**", "**/dist/**"],
      },
    },
    build: {
      // Small scripts are inlined into every page by default. The site hint
      // ships on all ~30k pages, so serve it as one cached file instead.
      assetsInlineLimit: (filePath) =>
        filePath.includes("SiteHint") ? false : undefined,
    },
  },
});
