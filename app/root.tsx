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
import { findActiveBan, getClientIp } from "./lib/ip.server";
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
  // moderation gate: IP-banned visitors get the ban screen, not the app
  // (bans are minted by the moderation API — see app/routes/api.moderation.*)
  try {
    const ban = await findActiveBan(getClientIp(args.request));
    if (ban) {
      return { banned: true as const, bannedUntil: ban.expiresAt.getTime() };
    }
  } catch {
    // Turso unconfigured — the shell must stay runnable without a database
  }
  if (!clerkConfigured) return null;
  return rootAuthLoader(args);
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager — must load as early as possible in <head> */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-W8B9FZ8W');`,
          }}
        />
        {/* End Google Tag Manager */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1c1917" />
        <meta
          name="google-adsense-account"
          content="ca-pub-3025736277635211"
        />
        {/* Google AdSense — loaded site-wide from the document head per
            Google's implementation guide (support.google.com/adsense/answer/9274019) */}
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3025736277635211"
          crossOrigin="anonymous"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Google Tag Manager (noscript) — immediately after the opening <body> tag */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-W8B9FZ8W"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
            title="Google Tag Manager"
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}
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

function BannedScreen({ until }: { until: number }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-[#f7f5f1] px-6 text-center text-stone-900">
      <h1 className="font-serif text-5xl tracking-tight">
        Scri<span className="italic text-stone-500">battle</span>
      </h1>
      <p className="text-lg font-medium text-red-700">You are banned from Scribattle.</p>
      <p className="max-w-sm text-sm text-stone-500">
        Repeated reports from other players earned this network a temporary ban. It
        lifts on {new Date(until).toLocaleDateString()}.
      </p>
    </main>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  // rootAuthLoader's return type hides our ban branch from narrowing — peek
  const ban = loaderData as unknown as { banned?: boolean; bannedUntil?: number } | null;
  if (ban?.banned && ban.bannedUntil) {
    return <BannedScreen until={ban.bannedUntil} />;
  }
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
