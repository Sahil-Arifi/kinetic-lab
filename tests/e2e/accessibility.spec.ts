import AxeBuilder from '@axe-core/playwright';
import { test, expect, loadWorkshop } from './support';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`@a11y DOM workshop has no axe violations at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loadWorkshop(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole('button', { name: 'Inspect performance', exact: true }).click();
    const inspectResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(inspectResults.violations).toEqual([]);
    if (viewport.width === 390) {
      await page.getByRole('button', { name: 'Inspector', exact: true }).click();
      const editorResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(editorResults.violations).toEqual([]);
    }
  });
}
