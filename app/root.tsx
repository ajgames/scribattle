import { ClerkProvider, useUser } from "@clerk/react-router";
import { clerkMiddleware, rootAuthLoader } from "@clerk/react-router/server";
import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { claimReferral, refreshProfile } from "./lib/profile";
import { clearPendingRef, loadPendingRef } from "./lib/referral";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
  },
];

// Clerk is wired but optional until keys land in .env — the shell must stay
// runnable before the Clerk app is even created.
const clerkConfigured = Boolean(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

// rootAuthLoader needs clerkMiddleware registered on the root route. Skip it
// entirely while Clerk is unconfigured so the shell stays runnable.
export const middleware: Route.MiddlewareFunction[] = clerkConfigured
  ? [clerkMiddleware()]
  : [];

export async function loader(args: Route.LoaderArgs) {
  if (!clerkConfigured) return null;
  return rootAuthLoader(args);
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1c1917" />
        <meta
          name="google-adsense-account"
          content="ca-pub-3025736277635211"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Boots the economy on the client: loads /api/profile into the store, and —
 * right after a fresh signup that arrived via a ?ref= link — attributes the
 * referral so the referrer earns credits. Renders nothing.
 */
function EconomyBoot() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (isLoaded) refreshProfile();
  }, [isLoaded, user?.id]);

  useEffect(() => {
    if (!user) return;
    const ref = loadPendingRef();
    if (!ref) return;
    clearPendingRef(); // one attempt per stored code, success or not
    // only fresh accounts count — signing in to a years-old account with a
    // stale ?ref in storage shouldn't pay anyone
    const ageMs = user.createdAt ? Date.now() - user.createdAt.getTime() : Infinity;
    if (ageMs < 24 * 60 * 60 * 1000) claimReferral(ref);
  }, [user?.id]);

  return null;
}

export default function App({ loaderData }: Route.ComponentProps) {
  if (!loaderData) return <Outlet />;
  return (
    <ClerkProvider loaderData={loaderData}>
      <EconomyBoot />
      <Outlet />
    </ClerkProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="font-serif text-4xl">{message}</h1>
      <p className="mt-2 text-stone-500">{details}</p>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto p-4 text-sm">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
