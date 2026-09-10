import { test, expect } from 'bun:test';
import { supervise } from '../packages/runtime/supervisor';
test('supervisor retries a failed child only within a bounded crash budget', async () => {
  let restarts = 0;
  const result = await supervise(
    [[process.execPath, '-e', 'process.exit(1)']],
    new AbortController().signal,
    { minDelayMs: 1, maxCrashes: 3, onRestart: () => restarts++ },
  );
  expect(result).toBe(1);
  expect(restarts).toBe(2);
});
test('intentional shutdown terminates both children without restarting', async () => {
  const controller = new AbortController();
  let restarts = 0;
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    expect(
      await supervise(
        [
          [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
          [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        ],
        controller.signal,
        { onRestart: () => restarts++ },
      ),
    ).toBe(0);
    expect(restarts).toBe(0);
  } finally {
    clearTimeout(timer);
  }
});
