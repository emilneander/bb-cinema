import { describe, test, expect } from 'bun:test';
import { Room } from '../packages/sync/room';
import { command, correction, expectedPosition } from '../packages/sync/protocol';
const item = 'a'.repeat(32);
function setup() {
  let time = 10000;
  const room = new Room(undefined, () => time);
  room.select(item, 100000);
  for (const id of ['owner', 'partner'] as const) {
    room.connect(id);
    room.apply(id, { type: 'ready' });
  }
  return {
    room,
    advance: (ms: number) => {
      time += ms;
      room.tick();
    },
    now: () => time,
  };
}
describe('authoritative playback', () => {
  test('requires both ready unless explicitly overridden', () => {
    const room = new Room();
    room.select(item, 100000);
    room.connect('owner');
    expect(() => room.apply('owner', { type: 'play' })).toThrow();
    room.apply('owner', { type: 'ready' });
    room.apply('owner', { type: 'play', override: true });
    expect(room.state.playing).toBe(true);
  });
  test('anchors pause and seek at server time and orders conflicts', () => {
    const { room, advance, now } = setup();
    room.apply('owner', { type: 'play' });
    advance(2300);
    expect(expectedPosition(room.state, now())).toBe(2300);
    room.apply('partner', { type: 'pause' });
    expect(room.state.positionMs).toBe(2300);
    const version = room.state.version;
    room.apply('owner', { type: 'seek', positionMs: 5000 });
    room.apply('partner', { type: 'seek', positionMs: 7000 });
    expect(room.state.positionMs).toBe(7000);
    expect(room.state.version).toBe(version + 2);
  });
  test('waits for buffering threshold, then pauses and resumes only after both recover', () => {
    const { room, advance } = setup();
    room.apply('owner', { type: 'play' });
    room.apply('partner', { type: 'buffering-started' });
    advance(1199);
    expect(room.state.playing).toBe(true);
    advance(1);
    expect(room.state.playing).toBe(false);
    room.apply('owner', { type: 'buffering-started' });
    room.apply('partner', { type: 'buffering-ended' });
    expect(room.state.playing).toBe(false);
    room.apply('owner', { type: 'buffering-ended' });
    expect(room.state.playing).toBe(true);
  });
  test('a deliberate pause cancels buffer auto-resume', () => {
    const { room, advance } = setup();
    room.apply('owner', { type: 'play' });
    room.apply('partner', { type: 'buffering-started' });
    advance(1200);
    room.apply('owner', { type: 'pause' });
    room.apply('partner', { type: 'buffering-ended' });
    expect(room.state.playing).toBe(false);
  });
  test('disconnect and silent heartbeat expiry pause and clear readiness', () => {
    const { room, advance } = setup();
    room.apply('owner', { type: 'play' });
    advance(15001);
    expect(room.state.playing).toBe(false);
    expect(room.participant('partner').ready).toBe(false);
    expect(room.participant('partner').connected).toBe(false);
  });
  test('restart restores a checkpoint paused at its projected position', () => {
    const { room, advance } = setup();
    room.apply('owner', { type: 'play' });
    advance(4000);
    const restored = new Room(room.durable());
    expect(restored.state.positionMs).toBe(4000);
    expect(restored.state.playing).toBe(false);
    expect(restored.state.version).toBeGreaterThan(room.state.version);
    expect(restored.state.participants.every((p) => !p.ready && !p.connected)).toBe(true);
  });
  test('small drift changes speed; large drift seeks; clamps duration', () => {
    expect(correction(1000, 1300)).toEqual({ rate: 1.02 });
    expect(correction(1300, 1000)).toEqual({ rate: 0.98 });
    expect(correction(1000, 1050)).toEqual({ rate: 1 });
    expect(correction(1000, 1500)).toEqual({ rate: 1, seek: 1500 });
    const { room } = setup();
    room.apply('owner', { type: 'seek', positionMs: 999999 });
    expect(room.state.positionMs).toBe(100000);
  });
  test('invalid protocol boundaries reject nonfinite positions and paths', () => {
    expect(command.safeParse({ type: 'seek', positionMs: Infinity }).success).toBe(false);
    expect(command.safeParse({ type: 'seek', positionMs: -1 }).success).toBe(false);
    expect(
      command.safeParse({ type: 'select-media', jellyfinItemId: '../../etc/passwd' }).success,
    ).toBe(false);
    expect(command.safeParse({ type: 'admin' }).success).toBe(false);
  });
});

test('solo playback resumes after pause and buffering, then accepts a second ready viewer', () => {
  const { room, advance } = setup();
  room.disconnect('partner');
  room.apply('owner', { type: 'play', override: true });
  room.apply('owner', { type: 'pause' });
  room.apply('owner', { type: 'play' });
  expect(room.state.playing).toBe(true);
  room.apply('owner', { type: 'buffering-started' });
  advance(1300);
  expect(room.state.playing).toBe(false);
  room.apply('owner', { type: 'buffering-ended' });
  expect(room.state.playing).toBe(true);
  room.connect('partner');
  room.apply('partner', { type: 'unready' });
  room.disconnect('partner');
  expect(room.state.playing).toBe(true);
  room.connect('partner');
  room.apply('partner', { type: 'ready' });
  expect(room.state.soloUserId).toBeUndefined();
  room.disconnect('partner');
  expect(room.state.playing).toBe(false);
});

test('next episode waits for both viewers to load before autoplaying', () => {
  const { room } = setup();
  room.select('b'.repeat(32), 100000, true);
  room.apply('owner', { type: 'ready' });
  expect(room.state.playing).toBe(false);
  room.apply('partner', { type: 'ready' });
  expect(room.state.playing).toBe(true);
  expect(room.state.autoStart).toBe(false);
  expect(room.state.positionMs).toBe(0);
});
test('pause cancels next episode autoplay and solo playback needs one ready viewer', () => {
  const { room } = setup();
  room.select('b'.repeat(32), 100000, true);
  room.apply('owner', { type: 'pause' });
  room.apply('owner', { type: 'ready' });
  room.apply('partner', { type: 'ready' });
  expect(room.state.playing).toBe(false);
  room.select('c'.repeat(32), 100000, true);
  room.state.soloUserId = 'owner';
  room.apply('owner', { type: 'ready' });
  expect(room.state.playing).toBe(true);
});

test('watch together clears solo and requires both to become ready again', () => {
  const { room, advance } = setup();
  room.apply('partner', { type: 'unready' });
  room.apply('owner', { type: 'play', override: true });
  advance(1000);
  room.apply('partner', { type: 'watch-together' });
  expect(room.state.soloUserId).toBeUndefined();
  expect(room.state.playing).toBe(false);
  expect(room.state.positionMs).toBe(1000);
  room.apply('owner', { type: 'ready' });
  expect(() => room.apply('owner', { type: 'play' })).toThrow();
  room.apply('partner', { type: 'ready' });
  room.apply('owner', { type: 'play' });
  expect(room.state.playing).toBe(true);
});

test('solo does not persist after leaving playback, disconnecting or restarting', () => {
  for (const action of ['leave-player', 'leave'] as const) {
    const { room } = setup();
    room.apply('partner', { type: 'unready' });
    room.apply('owner', { type: 'play', override: true });
    expect(new Room(room.durable()).state.soloUserId).toBeUndefined();
    room.apply('owner', { type: action });
    expect(room.state.soloUserId).toBeUndefined();
    expect(room.state.playing).toBe(false);
  }
});

test('solo override cannot start an unready viewer', () => {
  const { room } = setup();
  room.apply('owner', { type: 'unready' });
  expect(() => room.apply('owner', { type: 'play', override: true })).toThrow();
});
