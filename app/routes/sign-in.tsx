import { SignIn } from "@clerk/react-router";
import { pageMeta } from "../lib/seo";
import type { Route } from "./+types/sign-in";

export function meta({}: Route.MetaArgs) {
  return pageMeta({ title: "Sign in — Scribattle", noindex: true });
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
