import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default; SpacetimeDB handles realtime alongside SSR
  ssr: true,

  // Clerk's clerkMiddleware() needs the middleware pipeline, which is opt-in on
  // React Router v7 (always-on in v8, but v8 broke useNavigate in the root
  // component during SSR — see root.tsx / Auto-X for the matching setup).
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
} satisfies Config;