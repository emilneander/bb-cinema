'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { serverMessage, type Command, type RoomState } from '../../../packages/sync/protocol';
export function useRoom(csrf?: string) {
  const [room, setRoom] = useState<RoomState>(),
    [connected, setConnected] = useState(false),
    [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null),
    offset = useRef(0),
    latency = useRef(0),
    drift = useRef(0),
    position = useRef(0);
  const send = useCallback((event: Command) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(event));
      return true;
    }
    setError('Reconnecting to your cinema. Controls will return when connected.');
    return false;
  }, []);
  useEffect(() => {
    if (!csrf) return;
    let stopped = false,
      terminal = false,
      timer: ReturnType<typeof setTimeout>,
      attempt = 0;
    const samples: { rtt: number; offset: number }[] = [];
    const heartbeat = () => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(
          JSON.stringify({
            type: 'heartbeat',
            sentAt: Date.now(),
            latencyMs: latency.current,
            driftMs: drift.current,
            positionMs: Math.max(0, position.current),
          }),
        );
    };
    const connect = () => {
      if (stopped || terminal || !navigator.onLine) return;
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
        ['cinema', csrf],
      );
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        setError('');
        ws.send(JSON.stringify({ type: 'state-request' }));
        heartbeat();
      };
      ws.onmessage = (e) => {
        try {
          const msg = serverMessage.parse(JSON.parse(e.data));
          if (msg.type === 'state')
            setRoom((previous) =>
              !previous || msg.state.version >= previous.version ? msg.state : previous,
            );
          if (msg.type === 'error') setError(msg.message);
          if (msg.type === 'pong') {
            const now = Date.now(),
              rtt = now - msg.sentAt;
            if (rtt < 0 || rtt > 10000) return;
            samples.push({ rtt, offset: msg.serverMs - (msg.sentAt + now) / 2 });
            if (samples.length > 12) samples.shift();
            const best = [...samples].sort((a, b) => a.rtt - b.rtt)[0];
            offset.current = best.offset;
            latency.current = rtt / 2;
          }
        } catch {
          setError('Could not read the room state. Reload this page.');
        }
      };
      ws.onclose = (e) => {
        if (socket.current !== ws) return;
        setConnected(false);
        if (stopped) return;
        if (e.code === 4001 || e.code === 4003) {
          terminal = true;
          setError(
            e.code === 4001
              ? 'Playback is open in another tab. Close that tab and reload to return here.'
              : 'Your session expired. Reload to pair this device.',
          );
          return;
        }
        timer = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++) + Math.random() * 300);
      };
      ws.onerror = () => ws.close();
    };
    const offline = () => {
      clearTimeout(timer);
      setConnected(false);
      socket.current?.close(4000, 'Device offline');
    };
    const online = () => {
      clearTimeout(timer);
      if (
        socket.current?.readyState !== WebSocket.OPEN &&
        socket.current?.readyState !== WebSocket.CONNECTING
      )
        connect();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    connect();
    const interval = setInterval(heartbeat, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      socket.current?.close();
      socket.current = null;
    };
  }, [csrf]);
  return { room, connected, error, setError, send, offset, latency, drift, position };
}
export type RoomConnection = ReturnType<typeof useRoom>;
