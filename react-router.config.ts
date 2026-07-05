import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default; SpacetimeDB handles realtime alongside SSR
  ssr: true,
} satisfies Config;
