'use client';
import { useEffect, useRef } from 'react';
import type { LibraryItem } from '../../../packages/shared/types';
import { art } from './api';
import ProgressActions, { type ProgressChange } from './progress-actions';
import { Icon } from './icons';

export default function Library({
  items,
  select,
  openMovie,
  connected,
  show,
  season,
  openSeries,
  setSeason,
  back,
  changeProgress,
}: {
  items: LibraryItem[];
  select: (id: string) => void;
  openMovie: (item: LibraryItem) => void;
  connected: boolean;
  show?: string;
  season?: number;
  openSeries: (id: string, season: number) => void;
  setSeason: (season: number) => void;
  back: () => void;
  changeProgress: ProgressChange;
}) {
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const key = item.seriesId || item.id;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const episodes = show ? groups.get(show) : undefined;
  return (
    <>
      <div className="poster-grid">
        {[...groups.entries()].map(([id, entries]) => {
          const m = entries[0]!;
          const title = m.seriesName || m.title;
          const image =
            art(m.posterPath) || (m.imageId ? `/api/library/${m.imageId}/image` : undefined);
          return (
            <div key={id}>
              <button
                className="movie-card"
                onClick={() => {
                  if (m.seriesName) {
                    openSeries(id, Math.max(...entries.map((e) => e.season ?? 0)));
                  } else openMovie(m);
                }}
              >
                <div className="poster">
                  {image ? (
                    <img src={image} alt={`${title} poster`} loading="lazy" />
                  ) : (
                    <div className="poster-fallback">
                      <Icon name="film" size={28} />
                      <span>{title}</span>
                    </div>
                  )}
                </div>
                <h3 className={m.seriesName ? 'series-title' : ''}>{title}</h3>
                <p>
                  {m.seriesName
                    ? `${new Set(entries.map((e) => e.season)).size} seasons · ${entries.length} episodes`
                    : [m.year, `${Math.round(m.duration_ms / 60000)} min`]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
              </button>
            </div>
          );
        })}
      </div>
      {episodes && (
        <SeriesDetails
          key={show}
          episodes={episodes}
          season={season}
          setSeason={setSeason}
          select={select}
          connected={connected}
          close={back}
          changeProgress={changeProgress}
        />
      )}
    </>
  );
}

function SeriesDetails({
  episodes,
  season,
  setSeason,
  select,
  connected,
  close,
  changeProgress,
}: {
  episodes: LibraryItem[];
  season?: number;
  setSeason: (season: number) => void;
  select: (id: string) => void;
  connected: boolean;
  close: () => void;
  changeProgress: ProgressChange;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const info = episodes.find((e) => e.catalogTmdbId) || episodes[0]!;
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const seasons = [...new Set(episodes.map((e) => e.season ?? 0))].sort((a, b) => b - a);
  const current = season !== undefined && seasons.includes(season) ? season : seasons[0];
  const continuing = [...episodes]
    .filter((e) => (e.position_ms || 0) > 0 && (e.position_ms || 0) < e.duration_ms)
    .sort((a, b) => (b.progress_updated_at || 0) - (a.progress_updated_at || 0))[0];
  const resume =
    continuing ||
    [...episodes]
      .filter((e) => (e.season ?? 0) === current)
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))[0];
  return (
    <dialog
      ref={dialog}
      className="movie-dialog series-dialog"
      aria-labelledby="series-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="detail-art">
        {info.backdropPath && <img src={art(info.backdropPath, 'w1280')} alt="" />}
        <button
          className="icon-button close-dialog"
          aria-label="Close series details"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-content">
        <div className="detail-poster">
          {info.posterPath ? (
            <img src={art(info.posterPath)} alt={`${info.seriesName} poster`} />
          ) : (
            <Icon name="film" size={50} />
          )}
        </div>
        <div>
          <p className="eyebrow available-text">Ready to watch</p>
          <h2 id="series-modal-title" className="series-title">
            {info.seriesName}
          </h2>
          <p className="detail-facts">
            {[info.year, info.seriesGenres?.join(' · ')].filter(Boolean).join(' · ')}
          </p>
          {info.seriesOverview && <p className="synopsis">{info.seriesOverview}</p>}
          {resume && (
            <button
              className="button primary"
              disabled={!connected}
              onClick={() => select(resume.id)}
            >
              <Icon name="play" size={17} /> {continuing ? 'Continue' : 'Watch'} S{resume.season} ·
              E{resume.episode}
            </button>
          )}
        </div>
      </div>
      <div className="series-episodes">
        <div className="section-heading season-heading">
          <select
            aria-label="Season"
            value={current}
            onChange={(e) => setSeason(Number(e.target.value))}
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'Specials' : `Season ${s}`}
              </option>
            ))}
          </select>
        </div>
        <div className="episode-list">
          {episodes
            .filter((e) => (e.season ?? 0) === current)
            .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
            .map((e) => {
              const position = e.position_ms || 0;
              const watched = e.duration_ms > 0 && position >= e.duration_ms;
              const continuing = position > 0 && !watched;
              const title =
                e.episodeTitle || (/s\d+e\d+/i.test(e.title) ? `Episode ${e.episode}` : e.title);
              return (
                <div className="episode-entry" key={e.id}>
                  <button
                    className={`episode-row ${e.stillPath ? 'has-still' : ''} ${watched ? 'watched' : ''}`}
                    key={e.id}
                    disabled={!connected}
                    onClick={() => select(e.id)}
                  >
                    <span className="episode-number">
                      {String(e.episode ?? 0).padStart(2, '0')}
                    </span>
                    {e.stillPath && (
                      <img
                        className="episode-still"
                        src={art(e.stillPath, 'w300')}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <span className="episode-description">
                      <strong>{title}</strong>
                      <span className="episode-meta">
                        {continuing
                          ? `${Math.ceil((e.duration_ms - position) / 60000)} min left`
                          : `${Math.round(e.duration_ms / 60000)} min`}{' '}
                        {watched ? '· Watched' : continuing ? '· Continue' : ''}
                      </span>
                      {continuing && (
                        <progress
                          aria-label={`${title} progress`}
                          max={e.duration_ms}
                          value={position}
                        />
                      )}
                    </span>
                    <span className="episode-play">
                      <Icon name={watched ? 'check' : 'play'} size={18} />
                    </span>
                  </button>
                  <ProgressActions item={e} change={changeProgress} />
                </div>
              );
            })}
        </div>
      </div>
    </dialog>
  );
}
