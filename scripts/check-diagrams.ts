import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const CHECK = `([vw, vh]) => {
  const box = (el) => {
    const b = el.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height, id: (el.textContent || "").trim().slice(0, 34) };
  };
  const svg = document.querySelector("svg");
  const texts = Array.from(svg.querySelectorAll("text")).map(box);
  const masks = Array.from(svg.querySelectorAll("rect"))
    .filter((r) => (r.getAttribute("fill") || "") === "#f5f7fa")
    .map((r) => { const b = r.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  // Zone containers are painted first, so a label mask over one is allowed
  // (skill rule 6). Only node boxes matter for the overlap rule.
  const nodes = Array.from(svg.querySelectorAll("rect, polygon"))
    .filter((r) => r.getAttribute("fill") !== "#f5f7fa" && r.getAttribute("rx") !== "8")
    .map((r) => { const b = r.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height, diamond: r.tagName === "polygon" }; });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (o, t) => o.x <= t.x && o.y <= t.y && o.x + o.w >= t.x + t.w && o.y + o.h >= t.y + t.h;
  // Text must fit the narrowing diamond silhouette, not just its bounding box.
  const diamondFit = [];
  for (const t of texts) {
    const inner = nodes.filter((n) => n.diamond && inside(n, t));
    if (inner.length === 0) continue;
    const n = inner[0];
    const cy = t.y + t.h / 2;
    const dx = Math.abs(cy - (n.y + n.h / 2));
    const avail = n.w * (1 - dx / (n.h / 2));
    if (t.w > avail - 8) diamondFit.push({ id: t.id, needs: Math.round(t.w), has: Math.round(avail) });
  }
  const collisions = [];
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      if (hit(texts[i], texts[j])) collisions.push([texts[i].id, texts[j].id]);
  const outside = texts.filter((t) => t.x < 0 || t.y < 0 || t.x + t.w > vw || t.y + t.h > vh);
  const contains = inside;
  const uncovered = texts.filter((t) =>
    !masks.some((m) => contains(m, t)) && !nodes.some((n) => contains(n, t)));
  // A label straddling a box edge (partial overlap) does not fit its box.
  const straddling = texts.filter((t) =>
    nodes.some((n) => hit(n, t) && !contains(n, t)) ||
    masks.some((m) => hit(m, t) && !contains(m, t)));
  // Text inside a node must clear the border, and must not spill past the node
  // it is centred in (title and eyebrow are page-level, not node content).
  const tight = [];
  for (const t of texts) {
    if (t.y < 120) continue;
    const inner = nodes.filter((n) => contains(n, t));
    if (inner.length === 0) continue;
    const n = inner.sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const inset = Math.min(t.x - n.x, t.y - n.y, n.x + n.w - (t.x + t.w), n.y + n.h - (t.y + t.h));
    if (inset < 6) tight.push({ id: t.id, inset: Math.round(inset * 10) / 10 });
  }
  return { collisions, outside, uncovered, straddling, tight, diamondFit };
}`;

async function main() {
  const dir = resolve("docs/diagrams");
  const files = readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  const browser = await chromium.launch();
  let failures = 0;

  for (const f of files) {
    const stem = f.replace(/\.html$/, "");
    const html = readFileSync(join(dir, f), "utf8");
    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(html);
    if (!vb) throw new Error(`no viewBox in ${f}`);
    const vw = Number(vb[1]);
    const vh = Number(vb[2]);

    const png = readFileSync(join(dir, `${stem}.png`));
    const pw = png.readUInt32BE(16);
    const ph = png.readUInt32BE(20);
    const sizeOk = pw === vw * 2 && ph === vh * 2;

    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(join(dir, f)).href, { waitUntil: "domcontentloaded" });
    await page.evaluate("document.fonts.ready");
    const report = (await page.evaluate(`(${CHECK})(${JSON.stringify([vw, vh])})`)) as {
      collisions: unknown[];
      outside: unknown[];
      uncovered: unknown[];
      straddling: unknown[];
      tight: unknown[];
      diamondFit: unknown[];
    };

    const ok =
      sizeOk &&
      report.collisions.length === 0 &&
      report.outside.length === 0 &&
      report.uncovered.length === 0 &&
      report.straddling.length === 0 &&
      report.tight.length === 0 &&
      report.diamondFit.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${stem}: png ${pw}x${ph} (want ${vw * 2}x${vh * 2})` +
        ` textOverlaps=${report.collisions.length}` +
        ` outsideViewBox=${report.outside.length}` +
        ` textNotOnMaskOrNode=${report.uncovered.length}` +
        ` straddlingBoxEdge=${report.straddling.length}` +
        ` tightInset=${report.tight.length}` +
        ` diamondTextOverflow=${report.diamondFit.length}`,
    );
    if (report.diamondFit.length) console.log("     diamondOverflow:", JSON.stringify(report.diamondFit));
    if (report.collisions.length) console.log("     collisions:", JSON.stringify(report.collisions));
    if (report.outside.length) console.log("     outside:", JSON.stringify(report.outside));
    if (report.uncovered.length) console.log("     uncovered:", JSON.stringify(report.uncovered));
    if (report.straddling.length) console.log("     straddling:", JSON.stringify(report.straddling));
    if (report.tight.length) console.log("     tight:", JSON.stringify(report.tight));
    await page.close();
  }
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main();
