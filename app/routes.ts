import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("about", "routes/about.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("how-to-play", "routes/how-to-play.tsx"),
  route("lobby/:code", "routes/lobby.tsx"),
  route("game/:code", "routes/game.tsx"),
  route("watch/:code", "routes/watch.tsx"),
  route("shop", "routes/shop.tsx"),
  route("admin", "routes/admin.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("api/profile", "routes/api.profile.ts"),
  route("api/analytics/event", "routes/api.analytics.event.ts"),
  route("api/cron/metrics", "routes/api.cron.metrics.ts"),
  route("api/referral/claim", "routes/api.referral.claim.ts"),
  route("api/shop/buy", "routes/api.shop.buy.ts"),
  route("api/moderation/report", "routes/api.moderation.report.ts"),
  route("api/moderation/status", "routes/api.moderation.status.ts"),
  route("api/moderation/ack", "routes/api.moderation.ack.ts"),
] satisfies RouteConfig;
