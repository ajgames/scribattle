import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("lobby/:code", "routes/lobby.tsx"),
  route("game/:code", "routes/game.tsx"),
] satisfies RouteConfig;
