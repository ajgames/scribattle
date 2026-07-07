/**
 * Basic English profanity guard for user-authored text (guesses, usernames).
 *
 * Intentionally simple: a dictionary of whole words plus a short list of
 * substrings that are unambiguous even inside other words. Input is
 * de-leeted (0→o, 3→e, …) and checked both as-is and with repeated letters
 * squeezed ("fuuuck" → "fuck"), and once more with all separators stripped
 * ("f u c k" → "fuck"). Whole-word matching keeps innocent words containing
 * rude fragments (grass, class, Scunthorpe) out of the blast radius.
 */

// matched as whole tokens only — safe against innocent containing words
const BLOCKED_WORDS = new Set([
  'anal', 'anus', 'arse', 'arsehole', 'ass', 'asses', 'asshole', 'assholes',
  'ballsack', 'bastard', 'bastards', 'bitch', 'bitches', 'blowjob', 'bollocks',
  'boner', 'chink', 'clit', 'cock', 'cocks', 'coon', 'cum', 'cunt', 'cunts',
  'dick', 'dickhead', 'dicks', 'dildo', 'douche', 'douchebag', 'dumbass',
  'fag', 'fags', 'goddamn', 'handjob', 'hoe', 'hoes', 'jackass', 'jerkoff',
  'jizz', 'kike', 'milf', 'molest', 'molester', 'nutsack', 'penis', 'penises',
  'pinche', 'piss', 'pissed', 'porn', 'porno', 'prick', 'pricks', 'pussies',
  'pussy', 'queef', 'rape', 'raped', 'rapist', 'rectum', 'retard', 'retarded',
  'retards', 'schlong', 'scrotum', 'shat', 'shit', 'shits', 'shitty', 'skank',
  'slut', 'sluts', 'smegma', 'spic', 'tit', 'tits', 'titties', 'tranny',
  'twat', 'twats', 'vagina', 'wank', 'wanker', 'wetback', 'whore', 'whores',
]);

// unambiguous even embedded in longer strings ("fuckface", "fuuuckkk")
const BLOCKED_SUBSTRINGS = ['fuck', 'nigg', 'faggot'];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't',
};

function deLeet(text: string): string {
  return text.toLowerCase().replace(/[0134578@$!|+]/g, c => LEET[c] ?? c);
}

/** "fuuuck" → "fuck" (collapse runs of the same letter). */
function squeeze(text: string): string {
  return text.replace(/([a-z])\1+/g, '$1');
}

function formHits(form: string): boolean {
  const tokens = form.split(/[^a-z]+/).filter(Boolean);
  if (tokens.some(tok => BLOCKED_WORDS.has(tok))) return true;
  const collapsed = form.replace(/[^a-z]/g, '');
  return BLOCKED_SUBSTRINGS.some(s => collapsed.includes(s));
}

export function containsProfanity(text: string): boolean {
  const base = deLeet(text);
  return formHits(base) || formHits(squeeze(base));
}
