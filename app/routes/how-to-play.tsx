import { Link } from 'react-router';
import { ContentPage } from '../components/ContentPage';
import type { Route } from './+types/how-to-play';

export function meta({}: Route.MetaArgs) {
  const title = 'How to Play — Scribattle';
  const description =
    'Learn how to play Scribattle: create or join a room, take turns drawing a secret word, and race everyone else to guess the fastest for the biggest score.';
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
  ];
}

export default function HowToPlay() {
  return (
    <ContentPage title="How to Play">
      <p>
        Scribattle is a fast, free multiplayer drawing-and-guessing game you play right in your
        browser — no download, no install. One player draws a secret word while everyone else
        races to guess it. Here is everything you need to jump in.
      </p>

      <h3>1. Start or join a game</h3>
      <p>
        From the <Link to="/">home screen</Link>, pick a username and hit{' '}
        <strong>Create Game</strong> to spin up a new room. You will get a short room code you can
        share with friends. To join someone else&rsquo;s game instead, type their room code into
        the join box, or tap any game listed under <strong>Games happening now</strong>.
      </p>
      <p>
        Leave &ldquo;list my game publicly&rdquo; checked and strangers can drop in too — great for
        a quick match when your friends are offline.
      </p>

      <h3>2. Take turns drawing</h3>
      <p>
        Each round, one player becomes the artist and is given a secret word. The artist sketches
        it on the shared canvas — no letters, no numbers, no talking. Everyone else watches the
        drawing appear stroke by stroke in real time.
      </p>

      <h3>3. Race to guess</h3>
      <p>
        Guessers type what they think the word is. The faster you land the correct answer, the more
        points you score — so trust your gut and guess early. As the clock ticks down, letter hints
        are revealed to give everyone a fighting chance.
      </p>

      <h3>4. Score big and climb</h3>
      <p>
        The quickest correct guess earns the most, and the artist scores when people guess their
        drawing. Rounds rotate so everyone gets a turn on the pen. Highest total when the game ends
        wins bragging rights.
      </p>

      <h3>Tips for winning</h3>
      <ul>
        <li>As the artist, start with the big, recognizable shapes before adding detail.</li>
        <li>As a guesser, type partial ideas fast — early guesses are worth the most.</li>
        <li>Watch the hint letters late in the round to crack the tricky words.</li>
        <li>Invite a full room — the more guessers, the more chaotic and fun it gets.</li>
      </ul>

      <p>
        That&rsquo;s it. <Link to="/">Create a game</Link> and start scribbling.
      </p>
    </ContentPage>
  );
}
