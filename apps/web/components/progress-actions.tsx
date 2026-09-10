'use client';
import type { LibraryItem } from '../../../packages/shared/types';
export type ProgressChange = (id: string, action: 'watched' | 'reset') => void;
export default function ProgressActions({
  item,
  change,
}: {
  item: LibraryItem;
  change: ProgressChange;
}) {
  const watched = item.duration_ms > 0 && (item.position_ms || 0) >= item.duration_ms;
  return (
    <details className="progress-actions">
      <summary aria-label={`Progress options for ${item.episodeTitle || item.title}`}>•••</summary>
      <div className="progress-menu">
        {!watched && (
          <button
            onClick={(e) => {
              e.currentTarget.closest('details')!.open = false;
              change(item.id, 'watched');
            }}
          >
            Mark as watched
          </button>
        )}
        <button
          onClick={(e) => {
            e.currentTarget.closest('details')!.open = false;
            change(item.id, 'reset');
          }}
        >
          Reset progress
        </button>
      </div>
    </details>
  );
}
