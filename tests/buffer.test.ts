import { expect, test } from 'bun:test';
import {
  bufferedAhead,
  forwardBufferSeconds,
  hasRecoveryBuffer,
  playbackCushion,
} from '../packages/sync/buffer';
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
test('a longer cushion is honoured, but never beyond the end of the movie', () => {
  expect(hasRecoveryBuffer(ranges([0, 40]), 10, 100, 30)).toBe(true);
  expect(hasRecoveryBuffer(ranges([0, 39]), 10, 100, 30)).toBe(false);
  expect(hasRecoveryBuffer(ranges([0, 100]), 90, 100, 120)).toBe(true);
});
test('an HLS buffer starting just after the playhead still counts', () => {
  // Observed with HLS.js: playhead 0.00, buffered 0.02-56.02.
  expect(hasRecoveryBuffer(ranges([0.02, 56.02]), 0, 90, 30)).toBe(true);
  expect(hasRecoveryBuffer(ranges([1, 56]), 0, 90, 30)).toBe(false);
});
test('buffered ahead counts only the contiguous range at the playhead', () => {
  expect(bufferedAhead(ranges([0, 40]), 10)).toBe(30);
  expect(bufferedAhead(ranges([10.1, 40]), 10)).toBeCloseTo(30);
  expect(bufferedAhead(ranges([0, 11], [12, 30]), 20)).toBe(10);
  expect(bufferedAhead(ranges([0, 11], [12, 30]), 11.5)).toBe(0);
  expect(bufferedAhead(ranges(), 5)).toBe(0);
});
test('forward buffer is long for low bitrates and bounded by memory for high ones', () => {
  expect(forwardBufferSeconds(600_000)).toBe(600);
  expect(forwardBufferSeconds(1_500_000)).toBe(600);
  expect(forwardBufferSeconds(6_000_000)).toBe(200);
  expect(forwardBufferSeconds(10_000_000)).toBe(120);
  expect(forwardBufferSeconds(1_000_000_000)).toBe(60);
});
test('native players keep the short cushion; deep buffers wait longer after each stall', () => {
  expect(playbackCushion(0)).toBe(6);
  expect(playbackCushion(3)).toBe(6);
  expect(playbackCushion(0, 600)).toBe(30);
  expect(playbackCushion(1, 600)).toBe(30);
  expect(playbackCushion(2, 600)).toBe(60);
  expect(playbackCushion(5, 600)).toBe(120);
  // Never ask for more than the player is allowed to hold.
  expect(playbackCushion(5, 60)).toBe(48);
});
