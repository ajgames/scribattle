import { clerkClient, getAuth } from '@clerk/react-router/server';

/**
 * Admin allowlist — gate by the signed-in Clerk account's primary email.
 * Everyone else (signed out, wrong account, Clerk unconfigured) gets a 404 so
 * the admin surface doesn't advertise its existence.
 */
const ADMIN_EMAILS = new Set(['jake@dubsado.com']);

type AdminArgs = Parameters<typeof clerkClient>[0];

/** Loader/action guard: returns the admin's email, or throws a 404 Response. */
export async function requireAdmin(args: AdminArgs): Promise<string> {
  const notFound = () => new Response('Not Found', { status: 404 });

  let userId: string | null = null;
  try {
    userId = (await getAuth(args)).userId;
  } catch {
    throw notFound(); // Clerk unconfigured — nobody is an admin
  }
  if (!userId) throw notFound();

  const user = await clerkClient(args).users.getUser(userId);
  const email = (
    user.emailAddresses.find(e => e.id === user.primaryEmailAddressId) ??
    user.emailAddresses[0]
  )?.emailAddress?.toLowerCase();

  if (!email || !ADMIN_EMAILS.has(email)) throw notFound();
  return email;
}
