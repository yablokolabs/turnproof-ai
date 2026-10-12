import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Screenshots are captured from the running application, not mocked up. They are
 * written to `proof/screenshots/` and referenced by `proof/manifest.json`.
 */
const OUT_DIR = join(process.cwd(), 'proof', 'screenshots');

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test('capture the three demo states', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });

  await page.goto('/');
  await page.getByTestId('scenario-item-case-a').click();
  await expect(page.getByTestId('decision-state')).toContainText('recommended');
  await page.screenshot({ path: join(OUT_DIR, 'case-a-board.png'), fullPage: true });

  await page.getByTestId('scenario-item-case-b').click();
  await expect(page.getByTestId('decision-state')).toContainText('no_feasible_option');
  await page.screenshot({ path: join(OUT_DIR, 'case-b-no-feasible.png'), fullPage: true });

  await page.getByTestId('scenario-item-case-c').click();
  await expect(page.getByTestId('decision-state')).toContainText('needs_review');
  await page.screenshot({ path: join(OUT_DIR, 'case-c-abstain.png'), fullPage: true });
});
