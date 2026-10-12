/**
 * Build the README diagrams.
 *
 * For every HTML source in docs/diagrams:
 *   1. rasterise the <svg> element to a PNG with Playwright (the exact
 *      procedure in the diagram-design skill's references/export.md), then
 *   2. run the skill's own export_svg.py to emit a standalone, self-contained
 *      SVG next to it.
 *
 * Both artifacts are written to docs/diagrams/ and committed, so the README
 * never depends on this machine, on a network fetch, or on a running server.
 *
 * Playwright here is the Node install this repository already uses for the
 * end-to-end suite; the skill's detection step looks for the Python binding,
 * which is not installed and which this script does not install.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const DIAGRAMS_DIR = resolve("docs/diagrams");
const EXPORT_SVG = resolve(".agents/skills/diagram-design/scripts/export_svg.py");
const SCALE = 2;

const sources = readdirSync(DIAGRAMS_DIR)
  .filter((name) => name.endsWith(".html"))
  .sort();

if (sources.length === 0) {
  console.error(`no diagram HTML found in ${DIAGRAMS_DIR}`);
  process.exit(1);
}

const browser = await chromium.launch();

try {
  for (const name of sources) {
    const src = join(DIAGRAMS_DIR, name);
    const stem = basename(name, ".html");
    const png = join(DIAGRAMS_DIR, `${stem}.png`);

    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    await page.goto(`${pathToFileURL(src).href}?motion=static`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // Proxied or offline networks may stall a webfont subrequest past any
      // deadline; cancel the outstanding load so the capture cannot block on it.
      await page.evaluate("window.stop()");
      await page.waitForTimeout(4000);
      console.warn(
        `warning: ${name} - webfont request stalled; captured with fallback typography`,
      );
    }
    await page.evaluate("document.fonts.ready");

    const svg = page.locator("svg").first();
    // Release every clipping ancestor so a diagram wider than its frame is
    // captured whole rather than with a blank right edge.
    await svg.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        node.style.setProperty("overflow", "visible", "important");
        node = node.parentElement;
      }
    });

    await svg.screenshot({ path: png, omitBackground: true });
    await page.close();

    const svgOut = join(DIAGRAMS_DIR, `${stem}.svg`);

    // The skill's own extractor produces the standalone SVG. The skill is
    // installed on demand and is not vendored, so a fresh clone can build the
    // PNGs on their own and the already-committed SVG is left alone.
    if (existsSync(EXPORT_SVG)) {
      execFileSync("python3", [EXPORT_SVG, "--system-fonts", src], {
        stdio: "inherit",
      });
      console.log(`${name} -> ${basename(png)} + ${basename(svgOut)}`);
    } else {
      console.warn(
        `${name} -> ${basename(png)} (SVG export skipped: ${EXPORT_SVG} is absent)`,
      );
      console.warn(
        "  install the skill with: npx skills add cathrynlavery/diagram-design --skill diagram-design --yes",
      );
    }
  }
} finally {
  await browser.close();
}
