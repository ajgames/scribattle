import { useEffect, useRef } from 'react';
import { playSound } from '../lib/sounds';
import { useGameStore } from './store';

/**
 * Plays the shared SFX by diffing the store mirror across syncs: joins and
 * leaves from the roster, round/turn/status transitions from the room row,
 * correct guesses from the feed, and (when the caller passes the turn clock)
 * a 5-seconds-left countdown. Mounted by the lobby and game screens; the
 * first sync after mount only records a baseline so a refresh or deep link
 * doesn't replay history as a wall of sound.
 */
export function useGameSounds(secondsLeft?: number | null) {
  const players = useGameStore(s => s.players);
  const room = useGameStore(s => s.room);
  const guesses = useGameStore(s => s.guesses);

  const seenPlayers = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(players.map(p => p.id));
    const prev = seenPlayers.current;
    seenPlayers.current = ids;
    // no baseline yet, or the mirror was still empty (mid-connect) — record
    // only, otherwise the initial roster reads as everyone joining at once
    if (!prev || prev.size === 0) return;
    if ([...ids].some(id => !prev.has(id))) playSound('join');
    if ([...prev].some(id => !ids.has(id))) playSound('leave');
  }, [players]);

  const prevRoom = useRef<{
    status: string;
    turn: number;
    round: number;
    hasWord: boolean;
  } | null>(null);
  useEffect(() => {
    const cur = room
      ? {
          status: room.status,
          turn: room.turn,
          round: room.round,
          hasWord: room.currentWord !== '',
        }
      : null;
    const prev = prevRoom.current;
    prevRoom.current = cur;
    if (!prev || !cur) return;
    if (prev.status === 'waiting' && cur.status === 'playing') {
      playSound('roundStart');
    } else if (prev.status === 'playing' && cur.status === 'finished') {
      playSound('roundEnd');
    } else if (prev.status === 'playing' && cur.status === 'playing') {
      // the turn opens with a pick-a-word window, so 'newWord' fires when the
      // word actually locks in, not when the turn rotates
      if (cur.round !== prev.round) playSound('roundStart');
      else if (cur.turn === prev.turn && !prev.hasWord && cur.hasWord) playSound('newWord');
    }
  }, [room]);

  const seenCorrect = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(guesses.filter(g => g.correct).map(g => g.id));
    const prev = seenCorrect.current;
    seenCorrect.current = ids;
    if (!prev) return;
    if ([...ids].some(id => !prev.has(id))) playSound('correct');
  }, [guesses]);

  useEffect(() => {
    if (secondsLeft === 5) playSound('countdown');
  }, [secondsLeft]);
}
