import { Link } from 'react-router';
import { ContentPage } from '../components/ContentPage';
import type { Route } from './+types/privacy';

const CONTACT_EMAIL = 'jake@dubsado.com';
const LAST_UPDATED = 'July 6, 2026';

export function meta({}: Route.MetaArgs) {
  const title = 'Privacy Policy — Scribattle';
  const description =
    'How Scribattle collects, uses, and protects your information, including our use of cookies and third-party advertising such as Google AdSense.';
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
  ];
}

export default function Privacy() {
  return (
    <ContentPage title="Privacy Policy">
      <p>
        <strong>Last updated: {LAST_UPDATED}</strong>
      </p>
      <p>
        This Privacy Policy explains how Scribattle (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or
        &ldquo;our&rdquo;) collects, uses, and shares information when you use our website and game
        (the &ldquo;Service&rdquo;). By using the Service, you agree to the practices described
        here.
      </p>

      <h3>Information we collect</h3>
      <ul>
        <li>
          <strong>Account information.</strong> If you create an account, our authentication
          provider (Clerk) processes details such as your email address and a username on our
          behalf.
        </li>
        <li>
          <strong>Gameplay data.</strong> To run multiplayer games we process the username you
          choose, room codes, drawings, guesses, and scores while a game is in progress.
        </li>
        <li>
          <strong>Local storage.</strong> We store small pieces of data in your browser (for
          example, your chosen username and referral information) so the game works smoothly.
        </li>
        <li>
          <strong>Usage and device data.</strong> Like most websites, we and our service providers
          may automatically receive standard log information such as your browser type, approximate
          location, and pages visited.
        </li>
      </ul>

      <h3>How we use information</h3>
      <ul>
        <li>To provide, operate, and improve the Service and its multiplayer features.</li>
        <li>To maintain accounts, referrals, and in-game credits.</li>
        <li>To keep the Service secure and prevent abuse.</li>
        <li>To display advertising that helps keep the game free.</li>
      </ul>

      <h3>Cookies and advertising</h3>
      <p>
        We use cookies and similar technologies to run the Service and to serve ads. Third-party
        vendors, <strong>including Google</strong>, use cookies to serve ads based on your prior
        visits to this and other websites.
      </p>
      <ul>
        <li>
          Google&rsquo;s use of advertising cookies enables it and its partners to serve ads to you
          based on your visit to our site and/or other sites on the Internet.
        </li>
        <li>
          You may opt out of personalized advertising by visiting{' '}
          <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
            Google Ads Settings
          </a>
          .
        </li>
        <li>
          You can opt out of a third-party vendor&rsquo;s use of cookies for personalized
          advertising by visiting{' '}
          <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">
            www.aboutads.info
          </a>
          .
        </li>
        <li>
          For more information about how Google uses data, see{' '}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            target="_blank"
            rel="noopener noreferrer"
          >
            How Google uses information from sites or apps that use our services
          </a>
          .
        </li>
      </ul>
      <p>
        Most browsers let you refuse or delete cookies through their settings, though some features
        of the Service may not work correctly without them.
      </p>

      <h3>Third-party services</h3>
      <p>
        We rely on trusted third parties to operate the Service, including Google AdSense
        (advertising), Clerk (authentication), and infrastructure providers that host the game.
        These providers process data only as needed to deliver their services and under their own
        privacy policies.
      </p>

      <h3>Children&rsquo;s privacy</h3>
      <p>
        The Service is not directed to children under 13, and we do not knowingly collect personal
        information from them. If you believe a child has provided us with personal information,
        please contact us so we can remove it.
      </p>

      <h3>Your choices</h3>
      <p>
        You can play without an account, adjust or clear cookies in your browser, opt out of
        personalized ads using the links above, and request deletion of account data by contacting
        us.
      </p>

      <h3>Changes to this policy</h3>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will revise the
        &ldquo;Last updated&rdquo; date above. Continued use of the Service after changes take
        effect constitutes acceptance of the updated policy.
      </p>

      <h3>Contact us</h3>
      <p>
        If you have any questions about this Privacy Policy, email us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <p>
        <Link to="/">Return home</Link>
      </p>
    </ContentPage>
  );
}
