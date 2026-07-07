import { useState } from 'react';
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  type ReportReason,
} from '../lib/moderation';
import { submitReport } from '../lib/moderation.client';

/**
 * "Report artist" dialog: pick a reason (profane imagery / drawing words /
 * other), optionally add details, submit. The report carries a snapshot of
 * the game for the moderation records; the server decides the consequence.
 */
export function ReportModal({
  offenderIdentity,
  offenderName,
  gameCode,
  turn,
  onClose,
}: {
  offenderIdentity: string;
  offenderName: string;
  gameCode: string;
  turn: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit() {
    if (!reason || state === 'sending') return;
    setState('sending');
    try {
      await submitReport({ offenderIdentity, gameCode, turn, reason, details: details.trim() });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-lg">
        {state === 'sent' ? (
          <>
            <h2 className="font-medium">Report sent</h2>
            <p className="mt-2 text-sm text-stone-500">
              Thanks — the report and a snapshot of this game are with the moderators.
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-700"
            >
              Back to the game
            </button>
          </>
        ) : (
          <>
            <h2 className="font-medium">Report {offenderName}</h2>
            <p className="mt-1 text-xs text-stone-400">
              What's wrong with this drawing?
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {REPORT_REASONS.map(r => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    reason === r.id
                      ? 'border-stone-900 bg-stone-50'
                      : 'border-stone-200 hover:border-stone-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                    className="accent-stone-900"
                  />
                  {r.label}
                </label>
              ))}
            </div>

            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              maxLength={MAX_REPORT_DETAILS}
              rows={3}
              placeholder="anything else the moderators should know? (optional)"
              className="mt-3 w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-stone-300 focus:border-stone-400"
            />

            {state === 'error' && (
              <p className="mt-2 text-xs text-red-600">
                Could not send the report — try again in a moment.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-stone-200 bg-white py-2.5 text-sm text-stone-500 transition hover:text-stone-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!reason || state === 'sending'}
                className="flex-1 rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-stone-50 transition enabled:hover:bg-stone-700 disabled:opacity-40"
              >
                {state === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
