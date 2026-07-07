import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("about", "routes/about.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("how-to-play", "routes/how-to-play.tsx"),
  route("lobby/:code", "routes/lobby.tsx"),
  route("game/:code", "routes/game.tsx"),
  route("shop", "routes/shop.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("api/profile", "routes/api.profile.ts"),
  route("api/referral/claim", "routes/api.referral.claim.ts"),
  route("api/shop/buy", "routes/api.shop.buy.ts"),
] satisfies RouteConfig;
