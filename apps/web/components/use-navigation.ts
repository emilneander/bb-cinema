'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Movie } from '../../../packages/shared/types';
export type Tab = 'tonight' | 'discover' | 'wishlist' | 'library' | 'lobby' | 'settings';
type View = { tab: Tab; detail?: Movie; series?: string; season?: number; scroll: number };
const tabs: Tab[] = ['tonight', 'discover', 'wishlist', 'library', 'lobby', 'settings'];
function fromLocation(): View {
  const [section, query] = location.hash.slice(1).split('?');
  const tab =
    section === 'home' ? 'tonight' : tabs.includes(section as Tab) ? (section as Tab) : 'tonight';
  const params = new URLSearchParams(query);
  const season = params.has('season') ? Number(params.get('season')) : undefined;
  const saved = history.state?.cinemaView;
  return {
    tab,
    series: tab === 'library' ? params.get('series') || undefined : undefined,
    season: season !== undefined && Number.isInteger(season) && season >= 0 ? season : undefined,
    detail:
      saved?.detail && Number.isInteger(saved.detail.id) && typeof saved.detail.title === 'string'
        ? saved.detail
        : undefined,
    scroll: Number.isFinite(saved?.scroll) ? saved.scroll : 0,
  };
}
function address(view: View) {
  const params = new URLSearchParams();
  if (view.series) params.set('series', view.series);
  if (view.season !== undefined) params.set('season', String(view.season));
  return `#${view.tab === 'tonight' ? 'home' : view.tab}${params.size ? '?' + params : ''}`;
}
export function useNavigation() {
  const [view, setView] = useState<View>({ tab: 'tonight', scroll: 0 });
  const latest = useRef(view);
  latest.current = view;
  const restore = useRef<number | undefined>(undefined);
  function saveCurrent() {
    history.replaceState(
      { ...history.state, cinemaView: { ...latest.current, scroll: window.scrollY } },
      '',
    );
  }
  useEffect(() => {
    const initial = fromLocation();
    setView(initial);
    history.replaceState(
      { ...history.state, cinemaView: initial, cinemaDepth: history.state?.cinemaDepth || 0 },
      '',
      location.hash.startsWith('#invite=') ? location.hash : address(initial),
    );
    const oldRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const pop = () => {
      const next = fromLocation();
      restore.current = next.scroll;
      setView(next);
    };
    const save = () => saveCurrent();
    window.addEventListener('popstate', pop);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('pagehide', save);
      history.scrollRestoration = oldRestoration;
    };
  }, []);
  useLayoutEffect(() => {
    if (restore.current !== undefined) {
      window.scrollTo(0, restore.current);
      restore.current = undefined;
    }
  }, [view]);
  function navigate(next: View, replace = false) {
    saveCurrent();
    const depth = (history.state?.cinemaDepth || 0) + (replace ? 0 : 1);
    history[replace ? 'replaceState' : 'pushState'](
      { ...history.state, cinemaView: next, cinemaDepth: depth },
      '',
      address(next),
    );
    latest.current = next;
    restore.current = next.scroll;
    setView(next);
  }
  function back() {
    if (history.state?.cinemaDepth > 0) history.back();
    else
      navigate(
        { tab: view.series ? 'library' : view.detail ? view.tab : 'tonight', scroll: 0 },
        true,
      );
  }
  return {
    tab: view.tab,
    detail: view.detail,
    series: view.series,
    season: view.season,
    setTab: (tab: Tab) => {
      if (tab !== latest.current.tab || latest.current.detail || latest.current.series)
        navigate({ tab, scroll: 0 });
    },
    openSeries: (series: string, season: number) =>
      navigate({ tab: 'library', series, season, scroll: 0 }),
    setSeason: (season: number) =>
      navigate({ ...latest.current, season, scroll: window.scrollY }, true),
    openDetail: (detail: Movie) => navigate({ ...latest.current, detail, scroll: window.scrollY }),
    setDetail: (
      value: Movie | undefined | ((previous: Movie | undefined) => Movie | undefined),
    ) => {
      const next = {
        ...latest.current,
        detail: typeof value === 'function' ? value(latest.current.detail) : value,
      };
      latest.current = next;
      history.replaceState({ ...history.state, cinemaView: next }, '');
      setView(next);
    },
    back,
  };
}
