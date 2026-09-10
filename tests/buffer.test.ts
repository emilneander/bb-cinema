import { expect, test } from 'bun:test';
import { hasRecoveryBuffer } from '../packages/sync/buffer';
const ranges = (...pairs: number[][]) => ({
  length: pairs.length,
  start: (i: number) => pairs[i][0]!,
  end: (i: number) => pairs[i][1]!,
});
test('stall recovery waits for six contiguous seconds, not just canplay', () => {
  expect(hasRecoveryBuffer(ranges([0, 11]), 10, 100)).toBe(false);
  expect(hasRecoveryBuffer(ranges([0, 16]), 10, 100)).toBe(true);
  expect(hasRecoveryBuffer(ranges([0, 11], [12, 30]), 10, 100)).toBe(false);
});
test('recovery permits the final short segment but not a missing range', () => {
  expect(hasRecoveryBuffer(ranges([90, 100]), 98, 100)).toBe(true);
  expect(hasRecoveryBuffer(ranges(), 98, 100)).toBe(false);
  expect(hasRecoveryBuffer(ranges([0, 16]), 10, Infinity)).toBe(true);
});
