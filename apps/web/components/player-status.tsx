'use client';
import { useEffect, useState } from 'react';

type Phase = 'preparing' | 'loading' | 'buffering' | 'partner' | 'connecting' | 'idle' | 'error';

export function PlayerStatus({
  phase,
  name,
  progress,
  retry,
}: {
  phase: Phase;
  name: string;
  /** Visible progress while loading a long cushion, e.g. "0:12 of 0:30 loaded". */
  progress?: string;
  retry: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const busy = phase !== 'idle' && phase !== 'error';
  // Progress restarts the clock: a long cushion that keeps growing is not "slow".
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [phase, busy, progress]);
  const cushion = phase === 'buffering' && progress && !slow ? progress : undefined;
  const label =
    phase === 'error'
      ? 'Playback interrupted'
      : phase === 'idle'
        ? 'Ready when you are'
        : phase === 'partner'
          ? `Waiting for ${name}`
          : phase === 'connecting'
            ? 'Reconnecting…'
            : slow
              ? 'Still loading…'
              : phase === 'buffering'
                ? cushion
                  ? 'Loading ahead…'
                  : 'Buffering…'
                : phase === 'preparing'
                  ? 'Preparing video…'
                  : 'Loading video…';
  return (
    <div className={`player-status ${busy ? 'is-busy' : ''}`}>
      <div className="player-status-content">
        <div className="player-status-mark" aria-hidden="true">
          {busy ? (
            <>
              <span className="player-status-ring" />
              <span className="player-status-core" />
            </>
          ) : (
            <span className="player-status-symbol">{phase === 'error' ? '!' : '▶'}</span>
          )}
        </div>
        <p role="status" aria-live="polite">
          {label}
        </p>
        <span className="player-status-detail">
          {phase === 'idle'
            ? 'Tap “I’m ready” above to begin.'
            : phase === 'partner'
              ? 'Playback will resume when their video is ready.'
              : phase === 'error'
                ? 'Reconnect to try again.'
                : slow
                  ? 'The connection is taking longer than usual.'
                  : cushion || '\u00a0'}
        </span>
        {(phase === 'error' || (slow && phase !== 'partner' && phase !== 'connecting')) && (
          <button className="player-status-retry" onClick={retry}>
            Reconnect player <span aria-hidden="true">↻</span>
          </button>
        )}
      </div>
    </div>
  );
}
