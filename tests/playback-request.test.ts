import { afterEach, expect, test } from 'bun:test';
import { preparePlayback } from '../apps/web/components/api';
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
test('playback recovers after a lost response', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    if (++calls === 1) throw new TypeError('Load failed');
    return Response.json({ url: '/api/media/test' });
  }) as unknown as typeof fetch;
  expect(await preparePlayback<{ url: string }>({ method: 'POST' }, 'csrf')).toEqual({ url: '/api/media/test' });
  expect(calls).toBe(2);
});
test('playback does not retry rejected authentication', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ error: 'Sign in' }, { status: 401 });
  }) as unknown as typeof fetch;
  await expect(preparePlayback({}, 'csrf')).rejects.toThrow('Sign in');
  expect(calls).toBe(1);
});
test('leaving the player cancels pending retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError('Load failed');
  }) as unknown as typeof fetch;
  const request = preparePlayback({ signal: controller.signal }, 'csrf');
  setTimeout(() => controller.abort(), 20);
  await expect(request).rejects.toThrow();
  expect(calls).toBe(1);
});
