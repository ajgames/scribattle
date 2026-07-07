import { Link } from 'react-router';

const CONTACT_EMAIL = 'jake@dubsado.com';

/**
 * Shared footer with the crawlable links (how to play, about, privacy,
 * contact). Present on the home menu and every content page so the trust
 * pages are reachable — and indexable — from anywhere on the site.
 */
export function SiteFooter() {
  return (
    <footer className="w-full border-t border-stone-200 pt-6 text-center text-xs text-stone-400">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Link to="/" className="transition hover:text-stone-700">
          Home
        </Link>
        <Link to="/how-to-play" className="transition hover:text-stone-700">
          How to Play
        </Link>
        <Link to="/about" className="transition hover:text-stone-700">
          About
        </Link>
        <Link to="/privacy" className="transition hover:text-stone-700">
          Privacy
        </Link>
        <a href={`mailto:${CONTACT_EMAIL}`} className="transition hover:text-stone-700">
          Contact
        </a>
      </nav>
      <p className="mt-4">© {new Date().getFullYear()} Scribattle</p>
    </footer>
  );
}
