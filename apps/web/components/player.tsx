'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { correction, expectedPosition, type UserId } from '../../../packages/sync/protocol';
import type { RoomConnection } from './use-room';
import { api, preparePlayback } from './api';
import { Icon } from './icons';
import { PlayerStatus } from './player-status';
import { detectQuality } from './auto-quality';
import { hasRecoveryBuffer } from '../../../packages/sync/buffer';
import type { User, LibraryItem } from '../../../packages/shared/types';
const playbackSchema = z.object({
  streamId: z.uuid(),
  url: z.string().startsWith('/api/media/'),
  subtitleUrl: z.string().startsWith('/api/media/').optional(),
  mode: z.string(),
  bitrate: z.number(),
  hls: z.boolean(),
  tracks: z.array(
    z.object({
      Index: z.number(),
      Type: z.string(),
      DisplayTitle: z.string().nullable().optional(),
      Language: z.string().nullable().optional(),
      subtitleUrl: z.string().startsWith('/api/media/').optional(),
    }),
  ),
});
type Playback = z.infer<typeof playbackSchema>;
const time = (ms: number) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
export default function Player({
  connection,
  csrf,
  userId,
  title,
  users,
  nextEpisode,
}: {
  connection: RoomConnection;
  csrf: string;
  userId: UserId;
  title: string;
  users: User[];
  nextEpisode?: LibraryItem;
}) {
  const { room, send, connected, offset, latency, drift, position } = connection;
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null),
    current = useRef(room),
    ignoreUntil = useRef(0);
  current.current = room;
  const [quality, setQuality] = useState('auto'),
    [autoQuality, setAutoQuality] = useState<string>(),
    [audio, setAudio] = useState<number>(),
    [subtitle, setSubtitle] = useState(-1),
    [burnSubtitle, setBurnSubtitle] = useState(-1),
    [playback, setPlayback] = useState<Playback>(),
    [error, setError] = useState(''),
    [activated, setActivated] = useState(false),
    [loaded, setLoaded] = useState(false),
    [bufferedRanges, setBufferedRanges] = useState<{ start: number; end: number }[]>([]),
    [starting, setStarting] = useState(false),
    [reload, setReload] = useState(0),
    [now, setNow] = useState(0),
    [volume, setVolume] = useState(1),
    [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    seekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scrubbing = useRef(false),
    seekPreview = useRef(0),
    programmaticSeek = useRef(false),
    reportStarted = useRef(false),
    generation = useRef(0),
    startingRef = useRef(false),
    playbackAllowed = useRef(false),
    recovering = useRef(false);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setAutoQuality(undefined);
    void detectQuality(controller.signal).then((choice) => {
      if (!controller.signal.aborted) setAutoQuality(choice);
    });
    return () => controller.abort();
  }, [connected]);
  const effectiveQuality = quality === 'auto' ? autoQuality : quality;
  const item = room?.jellyfinItemId;
  useEffect(() => {
    const v = video.current;
    setBufferedRanges([]);
    if (!v || !playback) return;
    const update = () => {
      const snapshot = v.buffered;
      const ranges = Array.from({ length: snapshot.length }, (_, i) => ({
        start: snapshot.start(i) * 1000,
        end: snapshot.end(i) * 1000,
      }));
      setBufferedRanges((previous) =>
        previous.length === ranges.length &&
        previous.every((r, i) => r.start === ranges[i]?.start && r.end === ranges[i]?.end)
          ? previous
          : ranges,
      );
    };
    update();
    v.addEventListener('progress', update);
    v.addEventListener('emptied', update);
    // Also reflect evicted segments and native HLS updates without progress events.
    const timer = setInterval(update, 500);
    return () => {
      clearInterval(timer);
      v.removeEventListener('progress', update);
      v.removeEventListener('emptied', update);
    };
  }, [playback]);
  useEffect(() => {
    setAudio(undefined);
    setSubtitle(-1);
    setBurnSubtitle(-1);
    setActivated(false);
  }, [item]);
  useEffect(() => {
    if (!connected) {
      ignoreUntil.current = Date.now() + 500;
      video.current?.pause();
      setActivated(false);
    }
  }, [connected]);
  const activeStream = useRef<string | undefined>(undefined);
  const report = useCallback(
    (event: 'start' | 'progress' | 'stop', streamId = activeStream.current) => {
      if (!streamId) return Promise.resolve();
      const v = video.current;
      return api(
        '/playback/report',
        {
          method: 'POST',
          body: JSON.stringify({
            streamId,
            event,
            positionMs: Math.max(0, (v?.currentTime || 0) * 1000),
            paused: v?.paused ?? true,
          }),
        },
        csrf,
      ).catch(() => {});
    },
    [csrf],
  );
  useEffect(() => {
    if (!item || !connected || !effectiveQuality) return;
    const controller = new AbortController();
    let hls: { destroy: () => void } | undefined;
    let streamId: string | undefined;
    let autoStartTimer: ReturnType<typeof setTimeout> | undefined;
    const version = ++generation.current;
    setLoaded(false);
    recovering.current = false;
    startingRef.current = false;
    setStarting(false);
    setPlayback(undefined);
    setError('');
    setActivated(false);
    reportStarted.current = false;
    programmaticSeek.current = false;
    scrubbing.current = false;
    clearTimeout(seekTimer.current);
    seekTimer.current = undefined;
    send({ type: 'unready' });
    const v = video.current!;
    ignoreUntil.current = Date.now() + 1000;
    v.pause();
    preparePlayback<unknown>(
      {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          jellyfinItemId: item,
          quality: effectiveQuality,
          hevc: !!v.canPlayType('video/mp4; codecs="hvc1"'),
          audio,
          subtitle: burnSubtitle,
        }),
      },
      csrf,
    )
      .then(async (value) => {
        if (controller.signal.aborted || version !== generation.current) return;
        const p = playbackSchema.parse(value);
        streamId = p.streamId;
        activeStream.current = p.streamId;
        if (!p.hls || v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = p.url;
          v.load();
        } else {
          const { default: Hls } = await import('hls.js');
          if (controller.signal.aborted) return;
          if (!Hls.isSupported())
            throw new Error('This browser cannot play this HLS stream. Please use Safari.');
          const instance = new Hls({ maxBufferLength: 30, backBufferLength: 30 });
          hls = instance;
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              send({ type: 'unready' });
              send({ type: 'player-error', stage: 'hls' });
              setError('The stream was interrupted. Try reconnecting the player.');
            }
          });
          instance.loadSource(p.url);
          instance.attachMedia(v);
        }
        setPlayback(p);
        if (current.current?.autoStart && playbackAllowed.current) {
          // Reuse the video element whose playback the viewer already allowed.
          startingRef.current = true;
          setStarting(true);
          Promise.race([
            v.play(),
            new Promise<never>((_, reject) => {
              autoStartTimer = setTimeout(() => reject(new Error('Startup timed out')), 30000);
            }),
          ])
            .then(() => {
              if (controller.signal.aborted || version !== generation.current) return;
              v.pause();
              setActivated(true);
              send({ type: 'ready' });
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                v.pause();
                send({ type: 'unready' });
                setError('Tap “I’m ready” to start the next episode.');
              }
            })
            .finally(() => {
              clearTimeout(autoStartTimer);
              if (!controller.signal.aborted) {
                startingRef.current = false;
                setStarting(false);
              }
            });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          send({ type: 'player-error', stage: 'prepare' });
          setError(e instanceof Error ? e.message : 'Unable to prepare this movie.');
        }
      });
    return () => {
      controller.abort();
      clearTimeout(autoStartTimer);
      if (streamId) void report('stop', streamId);
      if (activeStream.current === streamId) activeStream.current = undefined;
      hls?.destroy();
      ignoreUntil.current = Date.now() + 500;
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [item, effectiveQuality, audio, burnSubtitle, reload, csrf, send, connected, report]);
  useEffect(() => {
    const interval = setInterval(() => {
      const v = video.current,
        s = current.current;
      if (
        !v ||
        !s ||
        !connected ||
        startingRef.current ||
        v.readyState < 2 ||
        v.seeking ||
        scrubbing.current ||
        seekTimer.current
      )
        return;
      const expected = expectedPosition(s, Date.now() + offset.current),
        actual = v.currentTime * 1000;
      drift.current = actual - expected;
      position.current = actual;
      setNow(actual);
      // Keep a stalled client out of the moving-target seek loop. Once the
      // server pauses the room, align once and refill at that shared position.
      if (
        recovering.current &&
        !v.seeking &&
        hasRecoveryBuffer(v.buffered, v.currentTime, v.duration)
      ) {
        recovering.current = false;
        send({ type: 'buffering-ended' });
      }
      if (recovering.current && s.playing) return;
      if (!s.playing) {
        if (!v.paused) {
          ignoreUntil.current = Date.now() + 500;
          v.pause();
        }
        if (Math.abs(actual - expected) > 250) {
          ignoreUntil.current = Date.now() + 1000;
          programmaticSeek.current = true;
          v.currentTime = expected / 1000;
        }
        v.playbackRate = 1;
        return;
      }
      if (!activated) return;
      const fix = correction(actual, expected);
      if (fix.seek !== undefined && !v.seeking) {
        ignoreUntil.current = Date.now() + 1000;
        programmaticSeek.current = true;
        v.currentTime = fix.seek / 1000;
      }
      v.playbackRate = fix.rate;
      if (v.paused) {
        ignoreUntil.current = Date.now() + 500;
        v.play().catch(() => {
          setActivated(false);
          send({ type: 'unready' });
          setError('Safari needs a tap to continue. Tap “I’m ready” again.');
        });
      }
    }, 250);
    return () => clearInterval(interval);
  }, [connected, activated, send, offset, drift, position]);
  useEffect(() => {
    if (!playback) return;
    const timer = setInterval(() => void report('progress'), 10000);
    return () => clearInterval(timer);
  }, [playback, report]);
  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      clearTimeout(seekTimer.current);
      send({ type: 'leave-player' });
    },
    [send, report],
  );
  function seekTo(value: number) {
    seekPreview.current = value;
    setNow(value);
    clearTimeout(seekTimer.current);
    if (scrubbing.current) return;
    seekTimer.current = setTimeout(() => {
      seekTimer.current = undefined;
      send({ type: 'seek', positionMs: value });
    }, 120);
  }
  function finishScrub() {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    seekTo(seekPreview.current);
  }
  async function ready() {
    const v = video.current;
    if (!v || !playback || startingRef.current) return false;
    const version = generation.current;
    startingRef.current = true;
    setStarting(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError('');
    ignoreUntil.current = Date.now() + 1500;
    try {
      // Invoke play synchronously from the tap: Safari may not preload any frames.
      await Promise.race([
        v.play(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('startup-timeout')), 30000);
        }),
      ]);
      if (version !== generation.current) return false;
      if (!current.current?.playing) v.pause();
      playbackAllowed.current = true;
      setActivated(true);
      send({ type: 'buffering-ended' });
      send({ type: 'ready' });
      if (!reportStarted.current) {
        reportStarted.current = true;
        void report('start');
      }
      return true;
    } catch (error) {
      if (version !== generation.current) return false;
      v.pause();
      send({ type: 'player-error', stage: 'startup' });
      setError(
        error instanceof Error && error.message === 'startup-timeout'
          ? 'The video is taking too long to load. Try a lower quality or reconnect.'
          : 'Tap “I’m ready” again to allow playback.',
      );
      return false;
    } finally {
      clearTimeout(timer);
      if (version === generation.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }
  const activity = () => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (current.current?.playing) setShowControls(false);
    }, 3000);
  };
  const nativeAction = (type: 'play' | 'pause') => {
    if (
      recovering.current ||
      Date.now() < ignoreUntil.current ||
      !activated ||
      video.current?.ended
    )
      return;
    if (type === 'pause' && current.current?.playing) send({ type: 'pause' });
    if (type === 'play' && !current.current?.playing) send({ type: 'play' });
  };
  const selectedTextSubtitle = playback?.tracks.find(
    (track) => track.Type === 'Subtitle' && track.Index === subtitle,
  )?.subtitleUrl;
  const self = room?.participants.find((p) => p.userId === userId);
  const allReady = Boolean(
    room?.participants
      .filter((p) => !room.soloUserId || room.soloUserId === p.userId)
      .every((p) => p.connected && p.ready && !p.buffering),
  );
  const waitingName = users.find((u) => u.id !== userId)?.name || 'the other viewer';

  return (
    <div className="player-section">
      <section className="ready-panel" aria-label="Lobby readiness">
        {room?.soloUserId && (
          <div className="ready-mode">
            <span>
              {room.soloUserId === userId
                ? 'Watching alone'
                : `${users.find((u) => u.id === room.soloUserId)?.name || 'Other viewer'} is watching alone`}
            </span>
            <button
              className="text-button"
              disabled={!connected}
              onClick={() => send({ type: 'watch-together' })}
            >
              Watch together
            </button>
          </div>
        )}
        <div className="ready-people">
          {users
            .filter((u) => u.named)
            .map((u) => {
              const participant = room?.participants.find((p) => p.userId === u.id);
              const isReady = participant?.connected && participant.ready && !participant.buffering;
              return (
                <div className={`ready-person ${isReady ? 'is-ready' : ''}`} key={u.id}>
                  <span className="ready-avatar">
                    {isReady ? <Icon name="check" size={18} /> : u.name[0]}
                  </span>
                  <div>
                    <strong>
                      {u.name}
                      {u.id === userId ? ' (you)' : ''}
                    </strong>
                    <span>
                      {!participant?.connected
                        ? 'Offline'
                        : participant.buffering
                          ? 'Buffering…'
                          : isReady
                            ? 'Ready'
                            : 'Getting ready'}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
        <div className="ready-actions">
          <button
            className="button primary"
            disabled={
              !connected ||
              !playback ||
              starting ||
              Boolean(self?.ready && !room?.playing && !allReady)
            }
            onClick={() => {
              if (room?.playing) send({ type: 'pause' });
              else if (!self?.ready) void ready();
              else send({ type: 'play' });
            }}
          >
            <Icon name={room?.playing ? 'pause' : self?.ready ? 'play' : 'check'} size={18} />
            {!connected
              ? 'Connecting…'
              : !playback
                ? 'Preparing video…'
                : starting
                  ? 'Loading video…'
                  : room?.playing
                    ? 'Pause'
                    : !self?.ready
                      ? 'I’m ready'
                      : allReady
                        ? room?.soloUserId
                          ? 'Play alone'
                          : 'Play'
                        : `Waiting for ${waitingName}`}
          </button>
          {!room?.playing && !allReady && (
            <button
              className="text-button"
              disabled={!playback || !connected || starting}
              onClick={async () => {
                if (await ready()) send({ type: 'play', override: true });
              }}
            >
              Watch alone
            </button>
          )}
          {self?.ready && !room?.playing && (
            <button className="text-button" onClick={() => send({ type: 'unready' })}>
              Cancel ready
            </button>
          )}
        </div>
        <p className="ready-caption" role="status">
          {room?.playing
            ? 'Playing'
            : !playback
              ? 'Preparing your video.'
              : starting
                ? 'Loading your video.'
                : !loaded
                  ? 'Tap “I’m ready” to load your video.'
                  : !self?.ready
                    ? 'Choose your audio and subtitles, then mark yourself ready.'
                    : allReady
                      ? 'Ready to start.'
                      : `${waitingName} hasn’t marked ready yet.`}
        </p>
      </section>
      <div
        ref={container}
        className={`player ${showControls || !room?.playing ? '' : 'controls-hidden'}`}
        onPointerMove={activity}
        onPointerDown={activity}
        onFocusCapture={() => setShowControls(true)}
      >
        <video
          ref={video}
          playsInline
          preload="auto"
          aria-label={title}
          onLoadedMetadata={() => {
            const s = current.current;
            if (video.current && s) {
              ignoreUntil.current = Date.now() + 1000;
              programmaticSeek.current = true;
              video.current.currentTime = expectedPosition(s, Date.now() + offset.current) / 1000;
            }
          }}
          onCanPlay={() => setLoaded(true)}
          onWaiting={() => {
            if (activated && !recovering.current) {
              recovering.current = true;
              send({ type: 'buffering-started' });
            }
          }}

          onPlay={() => nativeAction('play')}
          onPause={() => nativeAction('pause')}
          onSeeked={() => {
            // Network/HLS seeks may take much longer than the play/pause suppression window.
            // Completion of an authoritative seek must never become a new room command.
            if (programmaticSeek.current) {
              programmaticSeek.current = false;
              return;
            }
            if (activated && Date.now() > ignoreUntil.current && video.current)
              send({ type: 'seek', positionMs: video.current.currentTime * 1000 });
          }}
          onEnded={() => {
            if (item) send({ type: 'ended', jellyfinItemId: item });
          }}
          onError={() => {
            if (playback) {
              send({ type: 'unready' });
              send({ type: 'player-error', stage: 'media', code: video.current?.error?.code });
              setError('The video connection was interrupted. Try reconnecting the player.');
            }
          }}
        >
          {selectedTextSubtitle && (
            <track
              key={selectedTextSubtitle}
              kind="subtitles"
              src={selectedTextSubtitle}
              label="Selected subtitles"
              onLoad={(event) => {
                event.currentTarget.track.mode = 'showing';
              }}
              default
            />
          )}
        </video>
        {(error ||
          !connected ||
          !playback ||
          starting ||
          !loaded ||
          self?.buffering ||
          (!room?.playing &&
            room?.participants.some(
              (p) =>
                p.connected && p.buffering && (!room.soloUserId || room.soloUserId === p.userId),
            ))) && (
          <PlayerStatus
            phase={
              error
                ? 'error'
                : !connected
                  ? 'connecting'
                  : !playback
                    ? 'preparing'
                    : starting
                      ? 'loading'
                      : self?.buffering
                        ? 'buffering'
                        : room?.participants.some((p) => p.userId !== userId && p.buffering)
                          ? 'partner'
                          : !activated
                            ? 'idle'
                            : 'loading'
            }
            name={waitingName}
            retry={() => setReload((n) => n + 1)}
          />
        )}
        <div className="player-controls">
          <div className="progress">
            <div className="timeline-track" aria-hidden="true">
              {bufferedRanges.map((range, i) => {
                const duration = room?.durationMs || 1;
                const start = Math.max(0, Math.min(100, (range.start / duration) * 100));
                const end = Math.max(start, Math.min(100, (range.end / duration) * 100));
                return (
                  <span
                    key={i}
                    className="timeline-buffered"
                    style={{ left: `${start}%`, width: `${end - start}%` }}
                  />
                );
              })}
              <span
                className="timeline-played"
                style={{
                  width: `${Math.max(0, Math.min(100, (now / (room?.durationMs || 1)) * 100))}%`,
                }}
              />
            </div>
            <label className="sr-only" htmlFor="seek">
              Shared playback position
            </label>
            <input
              id="seek"
              type="range"
              min="0"
              max={room?.durationMs || 1}
              value={Math.min(now, room?.durationMs || 1)}
              disabled={!connected || !activated}
              onPointerDown={(e) => {
                scrubbing.current = true;
                seekPreview.current = now;
                clearTimeout(seekTimer.current);
                seekTimer.current = undefined;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerUp={finishScrub}
              onLostPointerCapture={finishScrub}
              onPointerCancel={() => {
                scrubbing.current = false;
              }}
              onBlur={finishScrub}
              onInput={(e) => seekTo(Number(e.currentTarget.value))}
            />
          </div>
          <div className="control-row">
            <button
              className="icon-button"
              aria-label={room?.playing ? 'Pause' : 'Play'}
              disabled={!activated || !connected || (!room?.playing && !allReady)}
              onClick={() => send(room?.playing ? { type: 'pause' } : { type: 'play' })}
            >
              <Icon name={room?.playing ? 'pause' : 'play'} />
            </button>
            <span className="timecode">
              {time(now)} <span>/ {time(room?.durationMs || 0)}</span>
            </span>
            <span className="control-spacer" />
            <label className="volume">
              <Icon name="volume" />
              <span className="sr-only">Local volume</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setVolume(value);
                  if (video.current) video.current.volume = value;
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Full screen"
              onClick={() => {
                const v = video.current as
                  (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
                const doc = document as Document & {
                  webkitFullscreenElement?: Element;
                  webkitExitFullscreen?: () => void;
                };
                const nativeVideo = v as
                  | (HTMLVideoElement & {
                      webkitDisplayingFullscreen?: boolean;
                      webkitExitFullscreen?: () => void;
                    })
                  | null;
                if (document.fullscreenElement) {
                  void document.exitFullscreen().catch(() => {});
                  return;
                }
                if (doc.webkitFullscreenElement) {
                  doc.webkitExitFullscreen?.();
                  return;
                }
                if (nativeVideo?.webkitDisplayingFullscreen) {
                  nativeVideo.webkitExitFullscreen?.();
                  return;
                }
                if (container.current?.requestFullscreen)
                  void container.current
                    .requestFullscreen()
                    .catch(() => v?.webkitEnterFullscreen?.());
                else v?.webkitEnterFullscreen?.();
              }}
            >
              <Icon name="expand" />
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}{' '}
          <button className="text-button" onClick={() => setReload((n) => n + 1)}>
            Reconnect player
          </button>
        </p>
      )}
      {nextEpisode && (
        <div className="next-episode">
          <button
            className="button"
            disabled={!connected}
            onClick={() => send({ type: 'select-media', jellyfinItemId: nextEpisode.id })}
          >
            Next episode <Icon name="arrow" size={18} />
          </button>
          <span>
            Episode {nextEpisode.episode}
            {nextEpisode.episodeTitle ? ` · ${nextEpisode.episodeTitle}` : ''}
          </span>
        </div>
      )}
      <div className="stream-settings">
        <label>
          Picture quality
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="auto">
              {autoQuality ? `Auto (${autoQuality.split('-')[0]}p)` : 'Auto (checking…)'}
            </option>
            <option value="1080-10">1080p · 10 Mbps</option>
            <option value="1080-6">1080p · 6 Mbps</option>
            <option value="1080-4">1080p · 4 Mbps</option>
            <option value="720-3">720p · 3 Mbps</option>
            <option value="720-1.5">720p · 1.5 Mbps</option>
            <option value="480-1">480p · 1 Mbps</option>
          </select>
        </label>
        <label>
          Audio
          <select
            value={audio ?? ''}
            onChange={(e) => setAudio(e.target.value === '' ? undefined : Number(e.target.value))}
          >
            <option value="">Original / default</option>
            {playback?.tracks
              .filter((t) => t.Type === 'Audio')
              .map((t) => (
                <option key={t.Index} value={t.Index}>
                  {t.DisplayTitle || t.Language || `Track ${t.Index}`}
                </option>
              ))}
          </select>
        </label>
        <label>
          Subtitles
          <select
            value={subtitle}
            onChange={(e) => {
              const index = Number(e.target.value);
              const track = playback?.tracks.find(
                (track) => track.Type === 'Subtitle' && track.Index === index,
              );
              setSubtitle(index);
              setBurnSubtitle(index === -1 || track?.subtitleUrl ? -1 : index);
            }}
          >
            <option value={-1}>Off</option>
            {playback?.tracks
              .filter((t) => t.Type === 'Subtitle')
              .map((t) => (
                <option key={t.Index} value={t.Index}>
                  {t.DisplayTitle || t.Language || `Track ${t.Index}`}
                </option>
              ))}
          </select>
        </label>
      </div>
    </div>
  );
}
