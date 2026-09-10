import { test, expect, type Page } from '@playwright/test';
const videoTime = (page: Page) =>
  page.locator('video').evaluate((v) => (v as HTMLVideoElement).currentTime);
test('two private sessions discover, save, play, pause, seek and reconnect', async ({
  browser,
  request,
}, testInfo) => {
  const codes = (await (await request.get('http://127.0.0.1:3412/fixtures/invites')).json()) as {
    owner: string;
    partner: string;
  };
  const host = await browser.newContext(),
    partner = await browser.newContext({ ...testInfo.project.use });
  const a = await host.newPage(),
    b = await partner.newPage();
  const errors: string[] = [];
  const seeks: number[] = [];
  a.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'seek') seeks.push(message.positionMs);
    }),
  );
  a.on('pageerror', (e) => errors.push(e.message));
  b.on('pageerror', (e) => errors.push(e.message));
  async function pair(page: Page, code: string, name: string) {
    await page.goto('/');
    await page.getByLabel('Invitation code').fill(code);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    if (name === 'Sam')
      await page.getByRole('button', { name: 'Add profile', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Discover', exact: true })).toBeVisible();
  }
  try {
    await pair(a, codes.owner, 'Alex');
    await pair(b, codes.partner, 'Sam');
    await a.screenshot({
      path: `test-results/${testInfo.project.name}-tonight.png`,
      fullPage: true,
    });
    await a.getByRole('button', { name: 'Discover', exact: true }).click();
    await expect(a.getByRole('combobox', { name: 'Genre', exact: true })).toBeVisible();
    await a.getByRole('combobox', { name: 'Genre', exact: true }).selectOption('18');
    await a.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('rated');
    await a.getByRole('button', { name: 'Series', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Series', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await a.getByRole('button', { name: 'Movies', exact: true }).click();
    await a.getByRole('searchbox', { name: 'Search titles' }).fill('Before Sunrise');
    await a.reload();
    await expect(a.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
    await expect(a.getByRole('searchbox', { name: 'Search titles' })).toHaveValue('Before Sunrise');
    await expect(a.getByRole('button', { name: 'Ready to watch', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Add to wishlist', exact: true })).toHaveCount(0);
    // An existing wishlist entry can remain after its movie becomes available.
    await a.evaluate(async () => {
      const me = await (await fetch('/api/me')).json();
      await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrf },
        body: JSON.stringify({ tmdbId: 76 }),
      });
    });
    await b
      .getByRole('navigation')
      .getByRole('button', { name: /^Wishlist/ })
      .click();
    await b.reload();
    await expect(b.getByRole('button', { name: 'Discover', exact: true })).toBeVisible();
    await expect(b.getByRole('heading', { name: 'Select profile', exact: true })).toHaveCount(0);
    await b
      .getByRole('navigation')
      .getByRole('button', { name: /^Wishlist/ })
      .click();
    await expect(b.getByRole('heading', { name: 'Before Sunrise', exact: true })).toBeVisible();
    await a.getByRole('button', { name: /Before Sunrise/ }).click();
    await expect(a.getByRole('region', { name: 'Similar', exact: true })).toBeVisible();
    const placement = await a.getByRole('dialog').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
    });
    expect(Math.abs(placement.x - (placement.viewportWidth - placement.width) / 2)).toBeLessThan(2);
    expect(Math.abs(placement.y - (placement.viewportHeight - placement.height) / 2)).toBeLessThan(
      2,
    );

    await a
      .getByRole('region', { name: 'Similar', exact: true })
      .getByRole('button', { name: /Similar fixture/ })
      .click();
    await expect(
      a.getByRole('dialog').getByRole('heading', { name: 'Similar fixture', exact: true }).first(),
    ).toBeVisible();
    await a.goBack();
    await expect(
      a.getByRole('dialog').getByRole('heading', { name: 'Before Sunrise', exact: true }).first(),
    ).toBeVisible();
    await a.getByRole('button', { name: 'Close movie details' }).click();
    await expect(a.getByRole('dialog')).toHaveCount(0);
    await expect(a.getByRole('searchbox', { name: 'Search titles' })).toHaveValue('Before Sunrise');
    await a.route('**/api/library', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: '1'.repeat(32),
              title: 'friends.s03e01',
              seriesName: 'Friends',
              seriesId: 'friends',
              season: 3,
              episode: 1,
              duration_ms: 1200000,
              available: 1,
            },
            {
              id: '2'.repeat(32),
              title: 'friends.s04e01',
              seriesName: 'Friends',
              seriesId: 'friends',
              season: 4,
              episode: 1,
              duration_ms: 1200000,
              available: 1,
            },
          ],
        },
      }),
    );
    await a.reload();
    await a.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await a.getByRole('button', { name: /Friends/ }).click();
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveValue('4');
    await expect(a.getByRole('button', { name: /Episode 1.*20 min/ })).toBeVisible();
    await a.getByRole('combobox', { name: 'Season' }).selectOption('3');
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveValue('3');
    await expect(a.getByRole('heading', { name: 'Library', exact: true })).toHaveCount(0);
    await expect(a.getByRole('button', { name: 'Refresh library', exact: true })).toHaveCount(0);
    await a.reload();
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveValue('3');
    await expect(a.getByRole('dialog', { name: 'Friends', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Close series details' }).click();
    await expect(a.getByRole('dialog')).toHaveCount(0);
    await a.goForward();
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveValue('3');
    await a.goBack();
    await expect(a.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveCount(0);
    await a.goForward();
    await expect(a.getByRole('combobox', { name: 'Season' })).toHaveValue('3');
    await a.unroute('**/api/library');
    await a.reload();
    await a.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await a.getByRole('button', { name: /Before Sunrise/ }).click();
    await expect(a.getByRole('dialog')).toBeVisible();
    await expect(a.getByRole('dialog').getByRole('button', { name: /wishlist/ })).toHaveCount(0);
    await a.getByRole('button', { name: 'Open lobby', exact: true }).click();
    await a.getByRole('button', { name: '← Back', exact: true }).click();
    await expect(a.getByRole('dialog')).toBeVisible();
    await a.getByRole('button', { name: 'Close movie details' }).click();
    await expect(a.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await a.getByRole('button', { name: /Before Sunrise/ }).click();
    await expect(a.getByRole('dialog')).toBeVisible();
    await expect(a.getByRole('dialog').getByRole('button', { name: /wishlist/ })).toHaveCount(0);
    await a.getByRole('button', { name: 'Open lobby', exact: true }).click();
    await b.getByRole('button', { name: 'Home', exact: true }).click();
    // No video bytes are available before the tap; readiness must remain actionable.
    let releaseMedia!: () => void;
    const mediaGate = new Promise<void>((resolve) => {
      releaseMedia = resolve;
    });
    await b.route('**/api/media/**', async (route) => {
      await mediaGate;
      await route.continue();
    });
    await b.getByRole('button', { name: 'Join lobby', exact: true }).first().click();
    await expect(a.getByRole('button', { name: 'I’m ready', exact: true })).toBeEnabled();
    await expect(b.getByRole('button', { name: 'I’m ready', exact: true })).toBeEnabled();
    if (testInfo.project.name === 'chromium') {
      await a.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect.poll(() => a.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await a.getByRole('button', { name: 'Full screen', exact: true }).click();
      await expect.poll(() => a.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    }
    await a.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Waiting for Sam', exact: true })).toBeDisabled();
    await a.getByRole('button', { name: 'Watch alone', exact: true }).click();
    await expect(a.getByText('Watching alone', { exact: true })).toBeVisible();
    await expect.poll(() => videoTime(a)).toBeGreaterThan(0.2);
    await b.getByRole('button', { name: 'Watch together', exact: true }).click();
    await expect(a.getByText('Watching alone', { exact: true })).toHaveCount(0);
    await expect
      .poll(() => a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
      .toBe(true);
    await a.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Waiting for Sam', exact: true })).toBeDisabled();

    expect(await b.locator('video').evaluate((v) => (v as HTMLVideoElement).readyState)).toBe(0);
    await b.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Loading video…', exact: true })).toBeDisabled();
    releaseMedia();
    await expect(a.getByRole('button', { name: 'Play', exact: true }).last()).toBeEnabled();
    await a.getByRole('button', { name: 'Play', exact: true }).last().click();
    await expect.poll(() => videoTime(a)).toBeGreaterThan(1);
    await expect.poll(() => videoTime(b)).toBeGreaterThan(1);
    await expect
      .poll(async () => Math.abs((await videoTime(a)) - (await videoTime(b))))
      .toBeLessThan(0.5);
    const beforeSubtitle = await b.locator('video').evaluate((v) => ({
      src: (v as HTMLVideoElement).currentSrc,
      time: (v as HTMLVideoElement).currentTime,
    }));
    for (const index of ['2', '3']) {
      await b.getByRole('combobox', { name: 'Subtitles', exact: true }).selectOption(index);
      await expect
        .poll(() =>
          b
            .locator('video')
            .evaluate((v) =>
              Array.from((v as HTMLVideoElement).textTracks).some(
                (t) => t.mode === 'showing' && (t.cues?.length || 0) > 0,
              ),
            ),
        )
        .toBe(true);
      expect(await b.locator('video').evaluate((v) => (v as HTMLVideoElement).currentSrc)).toBe(
        beforeSubtitle.src,
      );
      await expect(b.getByRole('button', { name: 'Pause', exact: true }).last()).toBeEnabled();
    }
    await b.getByRole('combobox', { name: 'Subtitles', exact: true }).selectOption('-1');
    await expect(b.locator('video track')).toHaveCount(0);
    expect(await b.locator('video').evaluate((v) => (v as HTMLVideoElement).currentSrc)).toBe(
      beforeSubtitle.src,
    );
    await expect.poll(() => videoTime(b)).toBeGreaterThan(beforeSubtitle.time);
    await b.getByRole('button', { name: 'Pause', exact: true }).last().click();
    await expect
      .poll(() => a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
      .toBe(true);
    const slider = a.getByLabel('Shared playback position');
    await slider.scrollIntoViewIfNeeded();
    const bounds = (await slider.boundingBox())!;
    const beforeDrag = seeks.length;
    await a.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + bounds.height / 2);
    await a.mouse.down();
    await a.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height / 2, { steps: 5 });
    await a.waitForTimeout(400);
    expect(seeks.length).toBe(beforeDrag);
    await a.mouse.up();
    await expect.poll(() => seeks.length).toBe(beforeDrag + 1);
    await a.getByLabel('Shared playback position').fill('30000');
    await expect.poll(() => videoTime(b)).toBeGreaterThan(29);
    await b.getByRole('button', { name: 'Play', exact: true }).last().click();
    await expect.poll(() => videoTime(a)).toBeGreaterThan(30.5);
    // Exercise the client -> server buffering protocol without altering codec behavior.
    await b.locator('video').evaluate((v) => {
      Object.defineProperty(v, 'buffered', {
        configurable: true,
        get: () => ({
          length: 1,
          start: () => 0,
          end: () => (v as HTMLVideoElement).currentTime + 0.5,
        }),
      });
    });
    await b.locator('video').dispatchEvent('waiting');
    await expect
      .poll(() =>
        a.evaluate(async () => {
          const room = await (await fetch('/api/room')).json();
          return (
            !room.playing &&
            room.participants.some(
              (p: { userId: string; buffering: boolean }) => p.userId === 'partner' && p.buffering,
            )
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() => a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
      .toBe(true);
    await b.locator('video').dispatchEvent('canplay');
    await b.locator('video').dispatchEvent('playing');
    await b.waitForTimeout(750);
    expect(await a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused)).toBe(true);
    await b.locator('video').evaluate((v) => {
      // Restore the real downloaded buffer; recovery should happen without another event.
      Reflect.deleteProperty(v, 'buffered');
    });
    await expect
      .poll(() => a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused))
      .toBe(false);
    await partner.setOffline(true);
    await expect
      .poll(() => a.locator('video').evaluate((v) => (v as HTMLVideoElement).paused), {
        timeout: 22000,
      })
      .toBe(true);
    await partner.setOffline(false);
    // The existing page must recover by itself, without a manual reload.
    await expect(b.getByRole('button', { name: 'I’m ready', exact: true })).toBeEnabled();
    await b.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Play', exact: true }).last()).toBeEnabled();
    await a.getByRole('button', { name: 'Play', exact: true }).last().click();
    await expect
      .poll(async () => Math.abs((await videoTime(a)) - (await videoTime(b))))
      .toBeLessThan(0.5);
    await a.getByRole('button', { name: 'Pause', exact: true }).last().click();
    // 4 Mbps fixture negotiates HLS, exercising native WebKit and Chromium HLS.js.
    await b.getByLabel('Picture quality').selectOption('1080-4');
    await expect(b.getByRole('button', { name: 'I’m ready', exact: true })).toBeEnabled();
    await b.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await a.getByRole('button', { name: 'Play', exact: true }).last().click();
    await expect.poll(() => videoTime(b)).toBeGreaterThan(30);
    await b.screenshot({ path: `test-results/${testInfo.project.name}-lobby.png`, fullPage: true });
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
    await a.getByRole('button', { name: 'Home', exact: true }).click();
    await a.getByLabel('Progress options for Before Sunrise').click();
    await a.getByRole('button', { name: 'Mark as watched', exact: true }).click();
    await expect(a.getByRole('heading', { name: 'Continue watching', exact: true })).toHaveCount(0);
    await a.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await a.getByRole('button', { name: /Before Sunrise/ }).click();
    await a.getByRole('dialog').getByLabel('Progress options for Before Sunrise').click();
    await a.getByRole('button', { name: 'Reset progress', exact: true }).click();
    await expect
      .poll(async () =>
        a.evaluate(async () => (await (await fetch('/api/room')).json()).positionMs),
      )
      .toBe(0);
    await a.getByRole('dialog').getByRole('button', { name: 'Open lobby', exact: true }).click();
    await request.post('http://127.0.0.1:3412/fixtures/episodes');
    await a.reload();
    await b.reload();
    await expect(a.getByRole('heading', { name: 'Test series · S1 E1' })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Next episode', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await b.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await a.getByRole('button', { name: 'Play', exact: true }).last().click();
    await request.post('http://127.0.0.1:3412/fixtures/near-end');
    for (const page of [a, b]) {
      await expect(page.getByRole('heading', { name: 'Test series · S1 E2' })).toBeVisible();
      await expect.poll(() => videoTime(page)).toBeGreaterThan(0.5);
    }
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await partner.close();
  }
});

test('host setup link configures accounts and creates a viewer-only invitation', async ({
  browser,
  request,
}) => {
  const { code } = await (await request.post('http://127.0.0.1:3412/fixtures/setup')).json();
  const host = await browser.newContext(),
    guest = await browser.newContext();
  try {
    const page = await host.newPage();
    await page.goto(`/#invite=${code}`);
    await expect(page.getByLabel('Invitation code')).toHaveValue(code);
    expect(page.url()).not.toContain('invite=');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set up cinema' })).toBeVisible();
    await page.getByLabel('Jellyfin address').fill('http://127.0.0.1:3412');
    await page.getByLabel('Installed Jellyfin version').fill('12.0.0');
    for (const [index, name, account] of [
      [1, 'Alex', 'owner'],
      [2, 'Sam', 'partner'],
    ] as const) {
      const group = page.getByRole('group', { name: `Profile ${index}` });
      await group.getByLabel('Name', { exact: true }).fill(name);
      await group.getByLabel('Jellyfin username').fill(account);
      await group.getByLabel('Jellyfin password').fill('fixture-password');
    }
    await page.getByRole('button', { name: 'Check and save' }).click();
    await page.getByRole('button', { name: 'Alex', exact: true }).click();
    await page.getByRole('button', { name: 'Private settings' }).click();
    await page.getByRole('button', { name: 'Edit connections' }).click();
    await expect(page.getByRole('heading', { name: 'Connection settings' })).toBeVisible();
    await expect(page.getByLabel('Jellyfin password').first()).toHaveValue('');
    await page.route('**/api/library/sync', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fixture refresh failure' }),
      }),
    );
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Settings saved.' })).toHaveText(
      'Settings saved. Library refresh failed. You can retry from Library.',
    );
    await page.unroute('**/api/library/sync');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Connection settings saved.');
    await page.getByText('Invitations & devices', { exact: true }).click();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const link = await page.getByLabel('Invitation link').inputValue();
    const viewer = await guest.newPage();
    await viewer.goto(link);
    await viewer.getByRole('button', { name: 'Continue', exact: true }).click();
    await viewer.getByRole('button', { name: 'Alex', exact: true }).click();
    await viewer.getByRole('button', { name: 'Private settings' }).click();
    await expect(viewer.getByText('Invitations & devices', { exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Edit connections' })).toHaveCount(0);
    expect(await viewer.evaluate(async () => (await fetch('/api/host/config')).status)).toBe(403);
  } finally {
    await host.close();
    await guest.close();
  }
});
