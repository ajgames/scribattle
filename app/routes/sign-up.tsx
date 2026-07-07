import { SignUp } from "@clerk/react-router";
import { pageMeta } from "../lib/seo";
import type { Route } from "./+types/sign-up";

export function meta({}: Route.MetaArgs) {
  return pageMeta({ title: "Sign up — Scribattle", noindex: true });
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp />
    </div>
  );
}
