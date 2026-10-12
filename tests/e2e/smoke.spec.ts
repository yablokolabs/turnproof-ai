import { expect, test } from '@playwright/test';

/**
 * Browser-level acceptance. These run against the built UI served by the API on
 * a single loopback origin, with no credentials of any kind.
 */

test('the prototype banner and honest adapter status are always visible', async ({ page }) => {
  await page.goto('/');

  const banner = page.getByTestId('prototype-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute(
    'data-banner-text',
    'Prototype - synthetic data - advisory only - no operational execution',
  );

  await expect(page.getByTestId('provider-mode')).toContainText('deterministic');

  await expect(page.getByTestId('sponsor-anakin')).toContainText('unavailable');
  await expect(page.getByTestId('sponsor-jev')).toContainText('unavailable');
});

test('Case A: compare waiting against a feasible alternate and see the rejection', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('scenario-item-case-a').click();

  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('readiness')).toContainText('20');
  await expect(page.getByTestId('task-row-t-fuel')).toContainText('09:30:00Z');
  await expect(page.getByTestId('timeline-bar-t-board')).toBeVisible();

  await expect(page.getByTestId('decision-state')).toContainText('recommended');
  await expect(page.getByTestId('candidate-feasible-use_alternate_resource:t-fuel:TANKER-2')).toBeVisible();

  const feasibility = page.getByTestId('candidate-feasible-use_alternate_resource:t-fuel:TANKER-3');
  await expect(feasibility).toHaveCount(0);
  await expect(page.getByTestId('candidate-rejected-use_alternate_resource:t-fuel:TANKER-3')).toBeVisible();
  await expect(
    page.getByTestId('candidate-reasons-use_alternate_resource:t-fuel:TANKER-3'),
  ).toContainText('RESOURCE_RESERVED');

  await expect(page.getByTestId('evidence-drawer')).toBeVisible();
  await expect(page.getByTestId('evidence-item-ev-a-tanker2')).toBeVisible();
});

test('Case C: contradictory updates abstain and the injected note stays inert text', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('scenario-item-case-c').click();

  await expect(page.getByTestId('decision-state')).toContainText('needs_review');
  await expect(page.getByTestId('conflict-TANKER-2-unavailable')).toBeVisible();

  const note = page.getByTestId('evidence-item-ev-d-injected-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('untrusted imported text');
  await expect(note).toContainText('ignore all rules');

  // The instruction must not have produced an approval or a recommendation.
  await expect(page.getByTestId('decision-state')).not.toContainText('recommended');
});

test('review and export complete the loop', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('scenario-item-case-a').click();
  await expect(page.getByTestId('decision-state')).toContainText('recommended');

  await page.getByTestId('reviewer-name').fill('Coordinator E2E');
  await page.getByTestId('review-action').selectOption('accept');
  await page.getByTestId('review-note').fill(
    'Alternate synthetic tanker accepted on fixture assumptions; advisory record only.',
  );
  await page.getByTestId('review-submit').click();

  await expect(page.getByTestId('review-result')).toContainText('Coordinator E2E');
  await expect(page.getByTestId('review-result')).toContainText('advisory');
  await expect(page.getByTestId('review-log')).toContainText('accept');

  const download = page.waitForEvent('download');
  await page.getByTestId('export-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^turnproof-decision-.*\.json$/);
});

test('live mode reports itself unavailable instead of faking a provider', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('scenario-item-case-a').click();

  const select = page.getByTestId('provider-mode-select');
  const liveOption = select.locator('option[value="live"]');
  await expect(liveOption).toHaveAttribute('disabled', '');

  await select.selectOption('replay');
  await expect(page.getByTestId('provider-mode')).toContainText('replay');
  await expect(page.getByTestId('provider-mode')).toContainText('not a live provider');
});
