'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Movie, User, LibraryItem } from '../../../packages/shared/types';
import { api, art } from './api';
import { Icon } from './icons';
import { useRoom } from './use-room';
import Player from './player';
import ProgressActions, { type ProgressChange } from './progress-actions';
import Library from './library';
import { Pair, Profiles } from './profiles';
import { HostSetup, HostDevices } from './host-setup';
type Identity = {
  user: User;
  users: User[];
  csrf: string;
  canManage: boolean;
  needsSetup: boolean;
};
import { useNavigation, type Tab } from './use-navigation';
export default function Cinema() {
  const [identity, setIdentity] = useState<Identity>(),
    [loading, setLoading] = useState(true),
    [profileSelected, setProfileSelected] = useState(false),
    [wishes, setWishes] = useState<Movie[]>([]),
    [library, setLibrary] = useState<LibraryItem[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('all');
  const {
    tab,
    setTab,
    detail,
    setDetail,
    openDetail: navigateDetail,
    series,
    season,
    openSeries,
    setSeason,
    back,
  } = useNavigation();
  const connection = useRoom(profileSelected ? identity?.csrf : undefined);
  const refresh = useCallback(async () => {
    const [w, l, p] = await Promise.all([
      api<{ items: Movie[] }>('/wishlist'),
      api<{ items: LibraryItem[] }>('/library'),
      api<{ users: User[] }>('/profiles'),
    ]);
    setWishes(w.items);
    setLibrary(l.items);
    setIdentity((current) => (current ? { ...current, users: p.users } : current));
  }, []);
  const loadIdentity = useCallback(
    () =>
      api<Identity>('/me')
        .then((value) => {
          setIdentity(value);
          try {
            setProfileSelected(
              Boolean(value.user.named) &&
                sessionStorage.getItem('cinema.profile') === value.user.id,
            );
          } catch {
            /* Storage may be disabled. */
          }
          return value;
        })
        .catch(() => setIdentity(undefined))
        .finally(() => setLoading(false)),
    [],
  );
  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);
  useEffect(() => {
    if (!identity) return;
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [identity?.csrf, refresh]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  async function toggleWish(m: Movie) {
    await action(async () => {
      if (m.addedBy)
        await api(
          `/wishlist/${m.id}?mediaType=${m.mediaType || 'movie'}`,
          { method: 'DELETE' },
          identity?.csrf,
        );
      else
        await api(
          '/wishlist',
          {
            method: 'POST',
            body: JSON.stringify({ tmdbId: m.id, mediaType: m.mediaType || 'movie' }),
          },
          identity?.csrf,
        );
      if (detail?.id === m.id)
        setDetail(await api<Movie>(`/movies/${m.id}?mediaType=${m.mediaType || 'movie'}`));
    });
  }
  async function openDetail(m: Movie) {
    navigateDetail(m);
    try {
      const loaded = await api<Movie>(`/movies/${m.id}?mediaType=${m.mediaType || 'movie'}`);
      setDetail((current) =>
        current?.id === m.id && current?.mediaType === m.mediaType ? loaded : current,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load details.');
    }
  }
  const changeProgress: ProgressChange = (id, progressAction) => {
    void action(() =>
      api(
        `/library/${id}/progress`,
        { method: 'POST', body: JSON.stringify({ action: progressAction }) },
        identity?.csrf,
      ),
    );
  };
  function openLibraryMovie(item: LibraryItem) {
    const id = item.manual_tmdb_id ?? item.tmdb_id;
    if (!id) {
      select(item.id);
      return;
    }
    void openDetail({
      id,
      mediaType: 'movie',
      title: item.title,
      jellyfinItemId: item.id,
      status: 'available',
    });
  }
  function select(id: string) {
    connection.send({ type: 'select-media', jellyfinItemId: id });
    setTab('lobby');
  }
  const selected = library.find((i) => i.id === connection.room?.jellyfinItemId);
  const nextEpisode =
    selected?.seriesId && selected.season !== undefined && selected.episode !== undefined
      ? library
          .filter(
            (item) =>
              item.available &&
              item.seriesId === selected.seriesId &&
              item.season === selected.season &&
              item.episode !== undefined &&
              item.episode > selected.episode!,
          )
          .sort((a, b) => a.episode! - b.episode!)[0]
      : undefined;
  const selectedTitle = selected?.seriesName
    ? `${selected.seriesName} · S${selected.season ?? '?'} E${selected.episode ?? '?'}${selected.episodeTitle ? ` · ${selected.episodeTitle}` : ''}`
    : selected?.title || 'Playback';
  const continuing = library
    .map((item) =>
      item.id === selected?.id
        ? { ...item, position_ms: connection.room?.positionMs || item.position_ms }
        : item,
    )
    .filter((item) => (item.position_ms || 0) > 0 && (item.position_ms || 0) < item.duration_ms)
    .sort((a, b) => (b.progress_updated_at || 0) - (a.progress_updated_at || 0));
  const latest = [...library].sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
  const nav: { id: Tab; name: string; icon: string }[] = [
    { id: 'tonight', name: 'Home', icon: 'moon' },
    { id: 'discover', name: 'Discover', icon: 'search' },
    { id: 'wishlist', name: 'Wishlist', icon: 'film' },
    { id: 'library', name: 'Library', icon: 'film' },
  ];
  if (loading)
    return (
      <main className="entry">
        <Brand />
        <p className="muted">Loading…</p>
      </main>
    );
  if (!identity) return <Pair onPaired={loadIdentity} />;
  if (identity.canManage && identity.needsSetup)
    return <HostSetup csrf={identity.csrf} users={identity.users} done={loadIdentity} />;
  if (!profileSelected)
    return (
      <Profiles
        identity={identity}
        onSelected={async () => {
          const value = await loadIdentity();
          if (!value) return;
          try {
            sessionStorage.setItem('cinema.profile', value.user.id);
          } catch {
            /* Selection still works without storage. */
          }
          setProfileSelected(true);
          setTab('tonight');
        }}
      />
    );
  const { user, users, csrf } = identity;
  const filtered = wishes.filter(
    (m) =>
      filter === 'all' ||
      (filter === 'available' && m.status === 'available') ||
      (filter === 'wanted' && m.status === 'wanted') ||
      (filter === 'watched' && m.status === 'watched'),
  );
  return (
    <div className="cinema-shell">
      <header className="site-header">
        <button
          className="brand-button"
          onClick={() => setTab('tonight')}
          aria-label="bb cinema home"
        >
          <Brand />
        </button>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? 'active' : ''}
              onClick={() => setTab(n.id)}
            >
              <Icon name={n.icon} size={18} />
              <span>{n.name}</span>
              {n.id === 'wishlist' && wishes.length > 0 && <small>{wishes.length}</small>}
            </button>
          ))}
        </nav>
        <button
          className="profile-button"
          aria-label="Private settings"
          onClick={() => setTab('settings')}
        >
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <span>{user.name}</span>
          <Icon name="settings" size={18} />
        </button>
      </header>
      <main className="main-content">
        {(error || connection.error) && (
          <div className="notice error" role="alert">
            {error || connection.error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => {
                setError('');
                connection.setError('');
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {tab === 'tonight' && (
          <>
            <div className="page-heading">
              <div>
                <h1>Home</h1>
              </div>
            </div>
            {selected && (
              <section className="home-lobby" aria-label="Open lobby">
                {(selected.backdropPath || selected.backdropId) && (
                  <img
                    src={
                      art(selected.backdropPath, 'w1280') ||
                      `/api/library/${selected.backdropId}/image?kind=Backdrop`
                    }
                    alt=""
                  />
                )}
                <div className="home-lobby-content">
                  <p className="eyebrow">{connection.room?.playing ? 'Playing' : 'Lobby open'}</p>
                  <h2>
                    {selected.seriesName
                      ? `${selected.seriesName} · S${selected.season} E${selected.episode}`
                      : selected.title}
                  </h2>
                  <p className="muted">
                    {users
                      .filter(
                        (u) =>
                          u.named &&
                          connection.room?.participants.some(
                            (p) => p.userId === u.id && p.connected,
                          ),
                      )
                      .map((u) => u.name)
                      .join(' · ')}{' '}
                    · Online
                  </p>
                  <button className="button primary" onClick={() => setTab('lobby')}>
                    <Icon name="play" size={18} /> Join lobby
                  </button>
                </div>
              </section>
            )}
            {continuing.length > 0 && (
              <section className="home-section">
                <div className="section-heading">
                  <h2>Continue watching</h2>
                </div>
                <div className="poster-grid continue-grid">
                  {continuing.map((item) => (
                    <div className="continue-item" key={item.id}>
                      <button
                        className="movie-card"
                        key={item.id}
                        onClick={() =>
                          item.id === selected?.id ? setTab('lobby') : select(item.id)
                        }
                      >
                        <div className="poster">
                          {item.stillPath || item.stillPath || item.posterPath || item.imageId ? (
                            <img
                              src={
                                art(item.stillPath, 'w300') ||
                                art(item.posterPath) ||
                                `/api/library/${item.imageId}/image`
                              }
                              alt={item.episodeTitle || item.title}
                            />
                          ) : (
                            <div className="poster-fallback">
                              <Icon name="film" />
                              <span>{item.title}</span>
                            </div>
                          )}
                        </div>
                        <h3>
                          {item.seriesName
                            ? `${item.seriesName} · S${item.season} E${item.episode}`
                            : item.title}
                        </h3>
                        <progress
                          aria-label={`${item.title} progress`}
                          value={item.position_ms}
                          max={item.duration_ms}
                        />
                        <p>
                          {Math.ceil((item.duration_ms - (item.position_ms || 0)) / 60000)} min left
                        </p>
                      </button>
                      <ProgressActions item={item} change={changeProgress} />
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className="home-section">
              <div className="section-heading">
                <h2>Recently added</h2>
              </div>
              {latest.length ? (
                <Library
                  items={latest}
                  changeProgress={changeProgress}
                  openSeries={openSeries}
                  setSeason={setSeason}
                  back={back}
                  select={select}
                  openMovie={openLibraryMovie}
                  connected={connection.connected}
                />
              ) : (
                <Empty
                  icon="film"
                  title="No movies"
                  text=""
                  action="Library"
                  onClick={() => setTab('library')}
                />
              )}
            </section>
          </>
        )}
        <div hidden={tab !== 'discover'}>
          <Discover wishes={wishes} open={openDetail} toggle={toggleWish} busy={busy} />
        </div>
        {tab === 'wishlist' && (
          <>
            <div className="page-heading">
              <div>
                <h1>Wishlist</h1>
              </div>
              <button className="button secondary" onClick={() => setTab('discover')}>
                <Icon name="plus" /> Find a film
              </button>
            </div>
            <div className="filter-row" aria-label="Wishlist filters">
              {[
                ['all', 'All films'],
                ['available', 'Available'],
                ['wanted', 'Wanted'],
                ['watched', 'Watched'],
              ].map(([id, name]) => (
                <button
                  key={id}
                  className={`chip ${filter === id ? 'selected' : ''}`}
                  onClick={() => setFilter(id)}
                >
                  {name}
                </button>
              ))}
            </div>
            {filtered.length ? (
              <div className="poster-grid">
                {filtered.map((m) => (
                  <MovieCard
                    key={`${m.mediaType || 'movie'}-${m.id}`}
                    movie={m}
                    onClick={() => void openDetail(m)}
                  />
                ))}
              </div>
            ) : (
              <Empty
                icon="heart"
                title={wishes.length ? 'No movies match this filter.' : 'No saved movies'}
                text=""
                action="Discover movies"
                onClick={() => setTab('discover')}
              />
            )}
          </>
        )}
        <div hidden={tab !== 'library'}>
          {!series && (
            <div className="page-heading">
              <div>
                <h1>Library</h1>
              </div>
              {identity.canManage && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(() => api('/library/sync', { method: 'POST' }, csrf))}
                >
                  {busy ? 'Checking…' : 'Refresh library'}
                </button>
              )}
            </div>
          )}
          {library.length ? (
            <Library
              items={library}
              changeProgress={changeProgress}
              show={series}
              season={season}
              openSeries={openSeries}
              setSeason={setSeason}
              back={back}
              select={select}
              connected={connection.connected}
              openMovie={openLibraryMovie}
            />
          ) : (
            <Empty
              icon="film"
              title="No movies"
              text=""
              action={identity.canManage ? 'Connection settings' : undefined}
              onClick={() => setTab('settings')}
            />
          )}
        </div>
        {tab === 'lobby' && (
          <>
            <div className="lobby-heading">
              <button className="text-button" onClick={back}>
                ← Back
              </button>
              <div className="page-heading">
                <h1>{selectedTitle}</h1>
              </div>
            </div>
            {selected ? (
              <>
                <Player
                  connection={connection}
                  csrf={csrf}
                  userId={user.id}
                  title={selectedTitle}
                  users={users}
                  nextEpisode={nextEpisode}
                />
              </>
            ) : (
              <Empty
                icon="moon"
                title="No movie selected."
                text=""
                action="Choose a film"
                onClick={() => setTab('library')}
              />
            )}
          </>
        )}
        {tab === 'settings' && (
          <Settings
            identity={identity}
            library={library}
            action={action}
            reload={loadIdentity}
            switchProfile={() => {
              try {
                sessionStorage.removeItem('cinema.profile');
              } catch {}
              setProfileSelected(false);
              setDetail(undefined);
            }}
            onLogout={() => {
              try {
                sessionStorage.removeItem('cinema.profile');
              } catch {}
              setIdentity(undefined);
              setProfileSelected(false);
              setWishes([]);
              setLibrary([]);
              setTab('tonight');
            }}
          />
        )}
      </main>
      {detail && (
        <Details
          key={`${detail.mediaType || 'movie'}-${detail.id}`}
          movie={detail}
          localItem={library.find((i) => i.id === detail.jellyfinItemId)}
          changeProgress={changeProgress}
          open={openDetail}
          busy={busy}
          close={back}
          toggle={() => void toggleWish(detail)}
          select={select}
        />
      )}
    </div>
  );
}
function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="film" size={23} />
      </span>
      <span>
        bb cinema<span className="brand-period">.</span>
      </span>
    </span>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
  onClick,
}: {
  icon: string;
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && (
        <button className="text-button" onClick={onClick}>
          {action} <Icon name="arrow" size={16} />
        </button>
      )}
    </div>
  );
}
function MovieCard({ movie: m, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <button className="movie-card" onClick={onClick}>
      <div className="poster">
        {m.poster_path ? (
          <img src={art(m.poster_path)} alt={`${m.title} poster`} loading="lazy" />
        ) : (
          <div className="poster-fallback">
            <Icon name="film" size={28} />
            <span>{m.title}</span>
          </div>
        )}
        {m.jellyfinItemId && (
          <span className="poster-badge">
            <span className="status-dot online" /> Available
          </span>
        )}
        <span className="poster-hover">
          <Icon name="plus" />
        </span>
      </div>
      <h3>{m.title}</h3>
      <p>
        {m.release_date?.slice(0, 4) || 'Release TBA'}
        {m.mediaType === 'tv' ? ' · Series' : ''}
        {m.runtime ? ` · ${m.runtime} min` : ''}
        {m.vote_average ? ` · ★ ${m.vote_average.toFixed(1)}` : ''}
      </p>
    </button>
  );
}
function MovieRow({
  title,
  subtitle,
  items,
  open,
  all,
  empty,
}: {
  title: string;
  subtitle: string;
  items: Movie[];
  open: (m: Movie) => unknown;
  all: () => void;
  empty?: React.ReactNode;
}) {
  return (
    <section className="movie-row">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="text-button" onClick={all}>
          View wishlist <Icon name="arrow" size={16} />
        </button>
      </div>
      {items.length ? (
        <div className="poster-grid">
          {items.map((m) => (
            <MovieCard
              key={`${m.mediaType || 'movie'}-${m.id}`}
              movie={m}
              onClick={() => void open(m)}
            />
          ))}
        </div>
      ) : (
        empty
      )}
    </section>
  );
}
function Discover({
  wishes,
  open,
  toggle,
  busy,
}: {
  wishes: Movie[];
  open: (m: Movie) => unknown;
  toggle: (m: Movie) => Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState(''),
    [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie'),
    [genre, setGenre] = useState(''),
    [genres, setGenres] = useState<{ id: number; name: string }[]>([]),
    [sort, setSort] = useState('popular'),
    [year, setYear] = useState(''),
    [page, setPage] = useState(1),
    [totalPages, setTotalPages] = useState(1),
    [results, setResults] = useState<Movie[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [filtersRestored, setFiltersRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('cinema.discover') || '{}');
      if (typeof saved.query === 'string') setQuery(saved.query);
      if (saved.mediaType === 'movie' || saved.mediaType === 'tv') setMediaType(saved.mediaType);
      if (typeof saved.genre === 'string') setGenre(saved.genre);
      if (typeof saved.year === 'string') setYear(saved.year);
      if (['popular', 'rated', 'recent'].includes(saved.sort)) setSort(saved.sort);
    } catch {}
    setFiltersRestored(true);
  }, []);
  useEffect(() => {
    if (!filtersRestored) return;
    try {
      sessionStorage.setItem(
        'cinema.discover',
        JSON.stringify({ query, mediaType, genre, year, sort }),
      );
    } catch {}
  }, [filtersRestored, query, mediaType, genre, year, sort]);
  useEffect(() => {
    const controller = new AbortController();
    setGenres([]);
    void api<{ genres: { id: number; name: string }[] }>(`/genres?mediaType=${mediaType}`, {
      signal: controller.signal,
    })
      .then((r) => setGenres(r.genres))
      .catch(() => {});
    return () => controller.abort();
  }, [mediaType]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ q: query.trim(), mediaType, sort, page: String(page) });
    if (!query.trim() && genre) params.set('genre', genre);
    if (year) params.set('year', year);
    const timer = setTimeout(
      () => {
        void api<{ results: Movie[]; totalPages: number }>(`/search?${params}`, {
          signal: controller.signal,
        })
          .then((r) => {
            if (!controller.signal.aborted) {
              setResults((previous) =>
                page === 1
                  ? r.results
                  : [...previous, ...r.results.filter((m) => !previous.some((p) => p.id === m.id))],
              );
              setTotalPages(r.totalPages);
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 350 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, mediaType, genre, year, sort, page]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loading || error || page >= totalPages || !results.length) return;
    const node = sentinel.current;
    if (!node) return;
    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!requested && entries.some((entry) => entry.isIntersecting)) {
          requested = true;
          observer.disconnect();
          setLoading(true);
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, error, page, totalPages, results.length]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Discover</h1>
        </div>
      </div>
      <label className="search-field">
        <Icon name="search" size={23} />
        <span className="sr-only">Search titles</span>
        <input
          type="search"
          placeholder="Search titles…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          autoComplete="off"
        />
        {query && (
          <button
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              setPage(1);
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </label>
      <div className="discovery-controls">
        <div className="filter-row" aria-label="Catalogue type">
          {(['movie', 'tv'] as const).map((type) => (
            <button
              key={type}
              className={`chip ${mediaType === type ? 'selected' : ''}`}
              aria-pressed={mediaType === type}
              onClick={() => {
                setMediaType(type);
                setGenre('');
                setPage(1);
              }}
            >
              {type === 'movie' ? 'Movies' : 'Series'}
            </button>
          ))}
        </div>
        <div className="discovery-selects">
          {!query.trim() && (
            <>
              <label>
                <span className="sr-only">Genre</span>
                <select
                  aria-label="Genre"
                  value={genre}
                  onChange={(e) => {
                    setGenre(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All genres</option>
                  {genres.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Sort</span>
                <select
                  aria-label="Sort"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="popular">Popular</option>
                  <option value="rated">Top rated</option>
                  <option value="recent">Recent</option>
                </select>
              </label>
            </>
          )}
          <label>
            <span className="sr-only">Year</span>
            <select
              aria-label="Year"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All years</option>
              {Array.from(
                { length: new Date().getFullYear() - 1899 },
                (_, i) => new Date().getFullYear() - i,
              ).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error ? (
        <Empty icon="search" title="Catalogue unavailable." text={error} />
      ) : loading && page === 1 ? (
        <div className="poster-grid" aria-label="Loading movies" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="poster skeleton" />
          ))}
        </div>
      ) : results.length ? (
        <div className="poster-grid">
          {results.map((raw) => {
            const saved = wishes.find(
              (w) => w.id === raw.id && (w.mediaType || 'movie') === (raw.mediaType || 'movie'),
            );
            const m = { ...raw, addedBy: saved?.addedBy };
            return (
              <div key={`${m.mediaType || 'movie'}-${m.id}`}>
                <MovieCard movie={m} onClick={() => void open(m)} />
                <button
                  className={`save-button ${m.addedBy ? 'saved' : ''}`}
                  disabled={busy}
                  onClick={() => (m.jellyfinItemId ? void open(m) : void toggle(m))}
                >
                  <Icon name={m.jellyfinItemId ? 'play' : m.addedBy ? 'check' : 'plus'} size={16} />
                  {m.jellyfinItemId
                    ? 'Ready to watch'
                    : m.addedBy
                      ? 'On wishlist'
                      : 'Add to wishlist'}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          icon="search"
          title="No results."
          text="Try an original title, another language, or a shorter search."
        />
      )}
      <div ref={sentinel} className="load-more" role="status">
        {loading && page > 1 ? 'Loading…' : ''}
      </div>
      {error && (
        <button
          className="button secondary"
          onClick={() => {
            setPage(1);
            setQuery('');
            setGenre('');
            setYear('');
            setSort('popular');
          }}
        >
          Reset filters
        </button>
      )}
    </>
  );
}
function Details({
  movie: m,
  localItem,
  changeProgress,
  open,
  busy,
  close,
  toggle,
  select,
}: {
  movie: Movie;
  localItem?: LibraryItem;
  changeProgress: ProgressChange;
  open: (m: Movie) => unknown;
  busy: boolean;
  close: () => void;
  toggle: () => void;
  select: (id: string) => void;
}) {
  const [similar, setSimilar] = useState<Movie[]>([]);
  const [similarError, setSimilarError] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSimilarLoading(true);
    setSimilarError(false);
    void api<{ results: Movie[] }>(`/movies/${m.id}/similar?mediaType=${m.mediaType || 'movie'}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setSimilar(r.results);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSimilarError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSimilarLoading(false);
      });
    return () => controller.abort();
  }, [m.id, m.mediaType, retry]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const node = dialog.current;
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="movie-dialog"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="detail-art">
        {m.backdrop_path && <img src={art(m.backdrop_path, 'w1280')} alt="" />}
        <button
          className="icon-button close-dialog"
          aria-label="Close movie details"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="detail-content">
        <div className="detail-poster">
          {m.poster_path ? (
            <img src={art(m.poster_path)} alt={`${m.title} poster`} />
          ) : (
            <Icon name="film" size={50} />
          )}
        </div>
        <div>
          <p className={`eyebrow ${m.jellyfinItemId ? 'available-text' : 'accent'}`}>
            {m.jellyfinItemId
              ? 'Ready to watch'
              : m.status === 'watched'
                ? 'Watched'
                : 'Not in library'}
          </p>
          <h2>{m.title}</h2>
          {m.original_title !== m.title && <p className="muted">{m.original_title}</p>}
          <p className="detail-facts">
            {[
              m.release_date?.slice(0, 4),
              m.runtime ? `${m.runtime} min` : null,
              m.vote_average ? `★ ${m.vote_average.toFixed(1)} TMDB` : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </p>
          <p className="muted">{m.genres?.map((g) => g.name).join(' · ')}</p>
          <p className="synopsis">{m.overview || 'No description available.'}</p>
          <div className="detail-actions">
            {m.jellyfinItemId && (
              <button className="button primary" onClick={() => select(m.jellyfinItemId!)}>
                <Icon name="play" size={17} /> Open lobby
              </button>
            )}
            {!m.jellyfinItemId && (
              <button className="button secondary" disabled={busy} onClick={toggle}>
                <Icon name={m.addedBy ? 'check' : 'plus'} size={17} />
                {m.addedBy ? 'Remove from wishlist' : 'Add to wishlist'}
              </button>
            )}
            {localItem && <ProgressActions item={localItem} change={changeProgress} />}
          </div>
          {m.credits?.cast.length ? (
            <div className="cast">
              <span className="eyebrow">CAST</span>
              <p>
                {m.credits.cast
                  .slice(0, 8)
                  .map((c) => c.name)
                  .join(' · ')}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <section className="similar-section" aria-label="Similar">
        <h3>Similar</h3>
        {similarLoading ? (
          <p className="muted" role="status">
            Loading…
          </p>
        ) : similarError ? (
          <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
            Couldn’t load titles. Retry
          </button>
        ) : similar.length ? (
          <div className="similar-row">
            {similar.map((item) => (
              <MovieCard
                key={`${item.mediaType}-${item.id}`}
                movie={item}
                onClick={() => void open(item)}
              />
            ))}
          </div>
        ) : (
          <p className="muted">No similar titles yet.</p>
        )}
      </section>
    </dialog>
  );
}
function Settings({
  identity,
  library,
  action,
  reload,
  onLogout,
  switchProfile,
}: {
  identity: Identity;
  library: LibraryItem[];
  action: (fn: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<unknown>;
  onLogout: () => void;
  switchProfile: () => void;
}) {
  const [editingConnections, setEditingConnections] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState('');
  const [name, setName] = useState(identity.user.name),
    [lang, setLang] = useState(identity.user.language),
    [diagnostics, setDiagnostics] = useState<{
      jellyfin: { ok: boolean; version?: string; message?: string };
      tmdb: { ok: boolean };
      tailscale: { status: string; https: boolean };
      room: {
        bufferingEvents: number;
        participants: { userId: string; latencyMs: number; driftMs: number }[];
      };
      streams: { userId: string; mode: string; bitrate: number }[];
      errors: { at: number; message: string }[];
    }>(),
    [testing, setTesting] = useState(false),
    [speed, setSpeed] = useState(''),
    [localItem, setLocalItem] = useState(''),
    [tmdbId, setTmdbId] = useState(''),
    [history, setHistory] = useState<
      { title?: string; started_at: number; completed_at?: number }[]
    >([]);
  useEffect(() => {
    void api<{ items: typeof history }>('/history')
      .then((r) => setHistory(r.items))
      .catch(() => {});
  }, []);
  if (editingConnections && identity.canManage)
    return (
      <HostSetup
        editing
        csrf={identity.csrf}
        users={identity.users}
        cancel={() => setEditingConnections(false)}
        done={async () => {
          setEditingConnections(false);
          setConnectionNotice('Connection settings saved.');
          await reload();
        }}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="settings-grid">
        {identity.canManage && (
          <section className="settings-section">
            <h2>Connections</h2>
            <button className="button secondary" onClick={() => setEditingConnections(true)}>
              Edit connections
            </button>
            {connectionNotice && <p role="status">{connectionNotice}</p>}
          </section>
        )}
        {identity.canManage && <HostDevices csrf={identity.csrf} />}
        <section className="settings-section">
          <h2>Profile</h2>
          <button className="text-button" onClick={switchProfile}>
            Switch profile
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(
                  '/settings',
                  { method: 'PATCH', body: JSON.stringify({ name, language: lang }) },
                  identity.csrf,
                );
                await reload();
              });
            }}
          >
            <label>
              Your name
              <input
                value={name}
                maxLength={40}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Movie information language
              <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
                <option value="en-US">English</option>
                <option value="sv-SE">Svenska</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </label>
            <p className="muted small">
              Search and movie details use your language. The shared list keeps a common English
              title.
            </p>
            <button className="button secondary">Save preferences</button>
          </form>
          <button
            className="text-button logout"
            onClick={() =>
              void action(async () => {
                await api('/logout', { method: 'POST' }, identity.csrf);
                onLogout();
              })
            }
          >
            Sign out of this device
          </button>
        </section>
        <details className="settings-section advanced-settings">
          <summary>Connection checks</summary>
          <p className="muted">Check the services and this device’s connection.</p>
          <div className="settings-actions">
            <button
              className="button secondary"
              disabled={testing}
              onClick={() => {
                setTesting(true);
                void action(async () => setDiagnostics(await api('/diagnostics'))).finally(() =>
                  setTesting(false),
                );
              }}
            >
              {testing ? 'Checking…' : 'Check connections'}
            </button>
            <button
              className="text-button"
              disabled={testing}
              onClick={() => {
                setTesting(true);
                setSpeed('Measuring an 8 MB sample…');
                const start = performance.now();
                fetch('/api/bitrate', { cache: 'no-store', signal: AbortSignal.timeout(60000) })
                  .then(async (r) => {
                    if (!r.ok) throw new Error();
                    const bytes = (await r.arrayBuffer()).byteLength;
                    const mbps = (bytes * 8) / (performance.now() - start) / 1000;
                    setSpeed(
                      `${mbps.toFixed(1)} Mbps measured. ${mbps >= 9 ? 'Try 1080p · 6 Mbps.' : mbps >= 4.5 ? 'Try 720p · 3 Mbps.' : mbps >= 2.25 ? 'Try 720p · 1.5 Mbps.' : mbps >= 1.5 ? 'Try 480p · 1 Mbps.' : mbps >= 0.9 ? 'Try 480p · 0.6 Mbps.' : 'This connection may be too slow even for 480p · 0.6 Mbps.'} A short sample is an estimate, not a guarantee.`,
                    );
                  })
                  .catch(() => setSpeed('Connection test failed. Check your tailnet connection.'))
                  .finally(() => setTesting(false));
              }}
            >
              Test this connection <Icon name="arrow" size={16} />
            </button>
          </div>
          {speed && (
            <p className="notice" role="status">
              {speed}
            </p>
          )}
          {diagnostics && (
            <div className="diagnostics">
              <p>
                <span className={`status-dot ${diagnostics.jellyfin.ok ? 'online' : ''}`} />{' '}
                Jellyfin {diagnostics.jellyfin.ok ? diagnostics.jellyfin.version : 'unavailable'}
              </p>
              {diagnostics.jellyfin.message && (
                <p className="muted small">{diagnostics.jellyfin.message}</p>
              )}
              <p>
                <span className={`status-dot ${diagnostics.tmdb.ok ? 'online' : ''}`} /> TMDB{' '}
                {diagnostics.tmdb.ok ? 'connected' : 'unavailable'}
              </p>
              <p className="muted small">{diagnostics.tailscale.status}</p>
              <p>
                {diagnostics.tailscale.https ? 'HTTPS configured' : 'Local HTTP configured'} ·{' '}
                {diagnostics.room.bufferingEvents} buffering events
              </p>
              {diagnostics.room.participants.map((p) => (
                <p key={p.userId}>
                  {p.userId}: {Math.round(p.latencyMs)} ms latency · {Math.round(p.driftMs)} ms
                  drift
                </p>
              ))}
              {diagnostics.streams.map((s) => (
                <p key={s.userId}>
                  {s.userId}: {s.mode} · {s.bitrate / 1000000} Mbps budget
                </p>
              ))}
              {diagnostics.errors.map((e, i) => (
                <p className="small muted" key={i}>
                  {new Date(e.at).toLocaleTimeString()} · {e.message}
                </p>
              ))}
            </div>
          )}
        </details>
        {identity.canManage && (
          <details className="settings-section advanced-settings">
            <summary>Library settings</summary>
            <p className="muted">
              Match a local film to its TMDB movie ID. This overrides Jellyfin’s catalogue match.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(() =>
                  api(
                    '/library/match',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        jellyfinItemId: localItem,
                        tmdbId: tmdbId ? Number(tmdbId) : null,
                      }),
                    },
                    identity.csrf,
                  ),
                );
              }}
            >
              <label>
                Local movie
                <select required value={localItem} onChange={(e) => setLocalItem(e.target.value)}>
                  <option value="">Choose a movie</option>
                  {library.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                TMDB movie ID
                <input
                  inputMode="numeric"
                  pattern="[0-9]+"
                  placeholder="For example,  Before Sunrise is 76"
                  value={tmdbId}
                  onChange={(e) => setTmdbId(e.target.value)}
                />
              </label>
              <p className="muted small">
                Leave the ID empty to return to Jellyfin’s automatic match.
              </p>
              <button className="button secondary">Save match</button>
            </form>
          </details>
        )}
        <section className="settings-section">
          <h2>Watch history</h2>
          {history.length ? (
            history.map((h, i) => (
              <p key={i}>
                <strong>{h.title || 'Movie'}</strong>
                <br />
                <span className="muted small">
                  {new Date(h.started_at).toLocaleDateString()} ·{' '}
                  {h.completed_at ? 'Watched' : 'In progress'}
                </span>
              </p>
            ))
          ) : (
            <p className="muted">Movies you play will appear here.</p>
          )}
        </section>
        <details className="credits-link">
          <summary>Credits</summary>
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            <img src="/tmdb.svg" alt="TMDB" width="130" height="18" />
          </a>
          <p className="small">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </details>
      </div>
    </>
  );
}
