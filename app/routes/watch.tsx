import { GameScreen } from './game';
import { pageMeta } from '../lib/seo';
import type { Route } from './+types/watch';

export function meta({ params }: Route.MetaArgs) {
  // rooms are ephemeral — keep them out of search indexes
  return pageMeta({ title: `Watching ${params.code} — Scribattle`, noindex: true });
}

/**
 * Watch mode: the game screen with a spectator row instead of a player row —
 * no username needed, guess input replaced by a join CTA. All the logic
 * lives in GameScreen; this route just flips the switch.
 */
export default function Watch({ params }: Route.ComponentProps) {
  return <GameScreen code={params.code.toUpperCase()} watch />;
}
