import { expect, test } from 'bun:test';
import { recommendedQuality } from '../apps/web/components/auto-quality';
test('auto leaves bandwidth headroom and falls back to 480p', () => {
  expect(recommendedQuality(2.9)).toBe('720-1.5');
  expect(recommendedQuality(1.7)).toBe('480-1');
  expect(recommendedQuality(0)).toBe('480-1');
  expect(recommendedQuality(5)).toBe('720-3');
  expect(recommendedQuality(10)).toBe('1080-6');
});
