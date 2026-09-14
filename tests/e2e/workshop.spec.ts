import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, loadWorkshop, marblePoint, settledTick, tick } from './support';

test('loads the Marble Run and supports playback, pause, exact single step and reset', async ({
  page,
}) => {
  await loadWorkshop(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('EXPERIMENT 001', { exact: true })).toBeVisible();
  expect(
    await page.getByRole('region', { name: 'Objects', exact: true }).getByRole('button').count(),
  ).toBeGreaterThanOrEqual(16);
  expect(await tick(page)).toBe(0);
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(() => tick(page)).toBe(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await expect.poll(() => tick(page)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  // Playback UI updates immediately; wait for the worker's final paused tick.
  const pausedTick = await settledTick(page);
  await page.getByRole('button', { name: 'Single step', exact: true }).click();
  await expect.poll(() => tick(page)).toBe(pausedTick + 1);
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect.poll(() => tick(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
});

test('keyboard selects objects, toggles playback and preserves editable fields', async ({
  page,
}) => {
  await loadWorkshop(page);
  const marble = page
    .getByRole('region', { name: 'Objects', exact: true })
    .getByRole('button', { name: /marble/i });
  await marble.focus();
  await page.keyboard.press('Enter');
  await expect(marble).toHaveAttribute('aria-pressed', 'true');
  const positionX = page.getByRole('spinbutton', { name: 'Position X', exact: true });
  await expect(positionX).toBeEnabled();
  await positionX.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await positionX.evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
});

test('edits authored objects, gravity, add, duplicate, delete and undo/redo', async ({ page }) => {
  await loadWorkshop(page);
  const gravity = page.getByRole('slider', { name: 'Gravity (m/s²)', exact: true });
  await gravity.focus();
  await page.keyboard.press('End');
  await expect(gravity).toHaveValue('0');
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const positionX = page.getByRole('spinbutton', { name: 'Position X', exact: true });
  await positionX.fill('2');
  await positionX.press('Tab');
  await expect(positionX).toHaveValue('2');
  await page.getByRole('button', { name: 'Undo scene edit', exact: true }).click();
  await expect(positionX).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo scene edit', exact: true }).click();
  await expect(positionX).toHaveValue('2');
  const objects = page.getByRole('region', { name: 'Objects', exact: true });
  const count = await objects.getByRole('button').count();
  await page.getByRole('button', { name: 'Duplicate selected object', exact: true }).click();
  await expect(objects.getByRole('button')).toHaveCount(count + 1);
  await page.getByRole('button', { name: 'Delete selected object', exact: true }).click();
  await expect(objects.getByRole('button')).toHaveCount(count);
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect(gravity).toHaveValue('0');
});

test('mouse dragging changes a dynamic object and Escape cancels a grab', async ({ page }) => {
  await loadWorkshop(page);
  const point = await marblePoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
  const initial = Number(
    await page.getByRole('spinbutton', { name: 'Position X', exact: true }).inputValue(),
  );
  await page.mouse.move(point.x + 75, point.y - 15, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
  await expect
    .poll(async () =>
      Number(await page.getByRole('spinbutton', { name: 'Position X', exact: true }).inputValue()),
    )
    .not.toBe(initial);
  const moved = await marblePoint(page);
  await page.mouse.move(moved.x, moved.y);
  await page.mouse.down();
  await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
  await page.mouse.up();
});

test('running mouse grab moves the real physics body and Escape releases it', async ({ page }) => {
  await loadWorkshop(page);
  await page.getByRole('slider', { name: 'Gravity (m/s²)', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => tick(page)).toBeGreaterThan(0);
  const point = await marblePoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
  await page.mouse.move(point.x + 80, point.y - 35, { steps: 12 });
  await expect
    .poll(async () => {
      const actual = await marblePoint(page);
      return Math.hypot(actual.x - point.x, actual.y - point.y);
    })
    .toBeGreaterThan(25);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
  await expect.poll(() => tick(page)).toBe(0);
  await expect(page.getByRole('spinbutton', { name: 'Position X', exact: true })).toHaveValue(
    '-6.15',
  );
});

test('Escape cancels a paused drag back to its simulated position without changing history', async ({
  page,
}) => {
  await loadWorkshop(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => tick(page)).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await settledTick(page);
  const original = await marblePoint(page);
  await page.mouse.move(original.x, original.y);
  await page.mouse.down();
  await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
  await page.mouse.move(original.x + 45, original.y - 20, { steps: 8 });
  await expect
    .poll(async () => {
      const preview = await marblePoint(page);
      return Math.hypot(preview.x - original.x, preview.y - original.y);
    })
    .toBeGreaterThan(15);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect
    .poll(async () => {
      const restored = await marblePoint(page);
      return Math.hypot(restored.x - original.x, restored.y - original.y);
    })
    .toBeLessThan(1);
  expect(await tick(page)).toBe(paused);
  await expect(page.getByRole('button', { name: 'Undo scene edit', exact: true })).toBeDisabled();
});

test('the real worker reaches the goal and Reset allows the experiment to repeat', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loadWorkshop(page);
  for (let run = 0; run < 2; run += 1) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Experiment complete', { exact: true })).toBeVisible({
      timeout: 35_000,
    });
    expect(await tick(page)).toBeGreaterThan(60);
    await page.getByRole('button', { name: 'Reset scene', exact: true }).click();
    await expect.poll(() => tick(page)).toBe(0);
    await expect(page.getByText('Experiment complete', { exact: true })).not.toBeVisible();
  }
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`workbench layout remains usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await loadWorkshop(page);
    await settledTick(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
    await expect(page.getByTestId('workshop-canvas')).toBeInViewport();
    const directory = resolve('artifacts/screenshots');
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `workbench-${viewport.width}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`workbench-${viewport.width}`, { path, contentType: 'image/png' });
  });
}

test.describe('single-touch mobile interaction', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('touch selects and drags the marble without multitouch', async ({ page, context }) => {
    await loadWorkshop(page);
    const point = await marblePoint(page);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y }],
    });
    await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 32, y: point.y - 12 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
    await expect(page.getByRole('button', { name: 'Undo scene edit', exact: true })).toBeEnabled();
    await session.detach();
  });

  test('one-finger running grab moves the physics body and cleans up on release', async ({
    page,
    context,
  }) => {
    await loadWorkshop(page);
    const gravity = await page
      .getByRole('slider', { name: 'Gravity (m/s²)', exact: true })
      .boundingBox();
    if (!gravity) throw new Error('Gravity control is not visible.');
    await page.touchscreen.tap(gravity.x + gravity.width - 1, gravity.y + gravity.height / 2);
    await expect(page.getByRole('slider', { name: 'Gravity (m/s²)', exact: true })).toHaveValue(
      '0',
    );
    await page.getByRole('button', { name: 'Play', exact: true }).tap();
    await expect.poll(() => tick(page)).toBeGreaterThan(0);
    const point = await marblePoint(page);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y }],
    });
    await expect(page.getByTestId('workshop-canvas')).toHaveClass(/is-dragging/);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 40, y: point.y - 25 }],
    });
    await expect
      .poll(async () => {
        const actual = await marblePoint(page);
        return Math.hypot(actual.x - point.x, actual.y - point.y);
      })
      .toBeGreaterThan(15);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
    await page.getByRole('button', { name: 'Reset scene', exact: true }).tap();
    await expect.poll(() => tick(page)).toBe(0);
    await session.detach();
  });

  test('single touch orbits the camera and visible zoom buttons need no multitouch', async ({
    page,
    context,
  }) => {
    await loadWorkshop(page);
    await page.getByRole('button', { name: 'Orbit view', exact: true }).tap();
    const before = await marblePoint(page);
    const canvas = await page.getByTestId('workshop-canvas').boundingBox();
    if (!canvas) throw new Error('Canvas is not visible.');
    const start = { x: canvas.x + canvas.width * 0.55, y: canvas.y + canvas.height * 0.65 };
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 50, y: start.y - 20 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    // Complete the raw CDP gesture before starting a separate native button tap.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect
      .poll(async () => {
        const actual = await marblePoint(page);
        return Math.hypot(actual.x - before.x, actual.y - before.y);
      })
      .toBeGreaterThan(5);
    await expect(page.getByTestId('workshop-canvas')).not.toHaveClass(/is-dragging/);
    const orbited = await marblePoint(page);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).tap();
    await expect
      .poll(async () => {
        const actual = await marblePoint(page);
        return Math.hypot(actual.x - orbited.x, actual.y - orbited.y);
      })
      .toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).tap();
    await expect
      .poll(async () => {
        const actual = await marblePoint(page);
        return Math.hypot(actual.x - orbited.x, actual.y - orbited.y);
      })
      .toBeLessThan(2);
  });
});
