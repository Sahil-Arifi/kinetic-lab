import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors, 'Browser must finish without uncaught exceptions or console errors').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});
export { expect };

export async function loadWorkshop(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.getByTestId('body-anchor-marble')).toBeAttached();
  await expect(page.getByTestId('workshop-canvas').locator('canvas')).toBeVisible();
}

export async function marblePoint(page: Page): Promise<{ x: number; y: number }> {
  const anchor = page.getByTestId('body-anchor-marble');
  await expect(anchor).toBeAttached();
  const bounds = await anchor.boundingBox();
  if (!bounds) throw new Error('Marble projection is not available.');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export async function tick(page: Page): Promise<number> {
  const text = await page.getByTestId('simulation-tick').textContent();
  const match = text?.match(/\d+/);
  if (!match) throw new Error(`No simulation tick in ${text}`);
  return Number(match[0]);
}

export async function settledTick(page: Page): Promise<number> {
  let lastTick = -1;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const value = await tick(page);
        stableSamples = value === lastTick ? stableSamples + 1 : 0;
        lastTick = value;
        return stableSamples;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(2);
  return lastTick;
}
