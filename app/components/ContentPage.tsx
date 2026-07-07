import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SiteFooter } from './SiteFooter';

/**
 * Reading layout for the static content pages (about, privacy, how-to-play).
 * A centered column of prose under the Scribattle wordmark, with the shared
 * footer nav so every page links back into the rest of the site.
 */
export function ContentPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="relative min-h-svh overflow-hidden bg-[#f7f5f1] text-stone-900">
      <div className="menu-backdrop" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-16">
        <header className="text-center">
          <h1 className="font-serif text-5xl tracking-tight text-stone-900">
            <Link to="/">
              Scri<span className="italic text-stone-500">battle</span>
            </Link>
          </h1>
        </header>

        <article className="content-prose">
          <h2 className="font-serif text-4xl tracking-tight text-stone-900">{title}</h2>
          {children}
        </article>

        <SiteFooter />
      </div>
    </main>
  );
}
