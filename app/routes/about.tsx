import { Link } from 'react-router';
import { ContentPage } from '../components/ContentPage';
import { pageMeta } from '../lib/seo';
import type { Route } from './+types/about';

const CONTACT_EMAIL = 'jake@dubsado.com';

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: 'About Scribattle — Free Online Drawing & Guessing Game',
    description:
      'Scribattle is a free, browser-based multiplayer drawing and guessing game. Learn what it is, who makes it, and how to get in touch.',
    path: '/about',
  });
}

export default function About() {
  return (
    <ContentPage title="About Scribattle">
      <p>
        <strong>Scribattle</strong> is a free, real-time multiplayer drawing and guessing game that
        runs entirely in your web browser. One player draws a secret word while everyone else races
        to guess it — the faster you guess, the more you score. It&rsquo;s the classic party game,
        reimagined for playing online with friends or strangers in seconds.
      </p>

      <h3>What makes it fun</h3>
      <ul>
        <li>
          <strong>Instant play.</strong> No downloads or installs — pick a name, create a room, and
          share the code.
        </li>
        <li>
          <strong>Real-time everything.</strong> Drawings and guesses appear live as they happen.
        </li>
        <li>
          <strong>Play with anyone.</strong> Start a private room for friends or list your game
          publicly so newcomers can join.
        </li>
        <li>
          <strong>Fast, replayable rounds.</strong> Turns rotate so everyone gets a chance to draw
          and to guess.
        </li>
      </ul>

      <h3>Who makes it</h3>
      <p>
        Scribattle is built and maintained by a small independent developer who loves quick,
        social browser games. It started as a passion project to bring the joy of couch drawing
        games to anyone with a web browser, anywhere.
      </p>

      <h3>Get in touch</h3>
      <p>
        Questions, feedback, bug reports, or business inquiries are always welcome. Reach us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <p>
        Ready to draw? <Link to="/">Start a game</Link> or read the{' '}
        <Link to="/how-to-play">how-to-play guide</Link>.
      </p>
    </ContentPage>
  );
}
