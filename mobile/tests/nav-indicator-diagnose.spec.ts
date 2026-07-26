import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Diagnostic: do bottom-nav indicator + sliding underline actually animate
 * on the USER's running pnpm dev server (http://localhost:3000)?
 *
 * Uses the real login flow so we hit the user's actual server (no E2E env).
 */

const OUT = path.join(__dirname, "screenshots", "nav-diagnose");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "wlsghtmeod@gmail.com";
const PASSWORD = "Test1234!";

interface IndicatorFrame {
  t: number;
  transform: string | null;
  inlineTransform: string | null;
  inlineStyleAttr: string | null;
  sameNode: boolean;
  markerStill: string | null;
}

type DiagnosticWindow = Window & typeof globalThis & {
  __indicatorFrames?: IndicatorFrame[];
};

test.use({
  viewport: { width: 375, height: 812 },
  storageState: { cookies: [], origins: [] }, // ignore auth.json — do real login
});

async function realLogin(page: Page) {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('[data-component="mobile_auth_login_form_submit-button"]');
  // Wait either for /select-branch or dashboard
  await page.waitForURL(/\/(select-branch|dashboard)/, { timeout: 15000 });
  if (page.url().includes("select-branch")) {
    // Click first branch row
    await page.click('[data-component="mobile_select-branch_page_list_row"]', { timeout: 10000 });
    await page.waitForTimeout(300);
    // Pick the first branch-btn ("선택" / "이동")
    const btn = page.locator(".branch-actions .branch-btn").first();
    await btn.click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  }
}

test("diagnose: bottom-nav indicator transition + position over time", async ({ page }) => {
  await realLogin(page);

  // Make sure we're on /dashboard
  await page.waitForURL("**/dashboard");
  await page.waitForTimeout(500);

  const nav = page.locator('[data-slot="mobile-bottom-nav"]');
  await expect(nav).toBeVisible();

  const indicator = nav.locator('[data-slot="mobile-bottom-indicator"]').first();
  await expect(indicator).toBeVisible();

  // ---- Capture the computed style on the user's server ----
  const meta = await indicator.evaluate((el) => ({
    transition: getComputedStyle(el).transition,
    transform: getComputedStyle(el).transform,
    transitionDuration: getComputedStyle(el).transitionDuration,
    transitionProperty: getComputedStyle(el).transitionProperty,
    transitionTimingFunction: getComputedStyle(el).transitionTimingFunction,
  }));
  console.log(`[user server indicator computed style] ${JSON.stringify(meta, null, 2)}`);

  // ---- Box at /dashboard ----
  const box0 = await indicator.boundingBox();
  await nav.screenshot({ path: path.join(OUT, "01-dashboard.png") });

  // ---- Click 고객 tab and capture frames during the 320ms slide ----
  const clientsTab = nav.locator('a[href="/clients"]');
  await clientsTab.click({ trial: false });

  // Quick succession of screenshots to catch mid-frame
  await page.waitForTimeout(40);
  const box40 = await indicator.boundingBox();
  await nav.screenshot({ path: path.join(OUT, "02-after-40ms.png") });

  await page.waitForTimeout(80); // total ~120ms
  const box120 = await indicator.boundingBox();
  await nav.screenshot({ path: path.join(OUT, "03-after-120ms.png") });

  await page.waitForTimeout(120); // total ~240ms
  const box240 = await indicator.boundingBox();
  await nav.screenshot({ path: path.join(OUT, "04-after-240ms.png") });

  await page.waitForTimeout(200); // total ~440ms — should be settled
  const boxFinal = await indicator.boundingBox();
  await nav.screenshot({ path: path.join(OUT, "05-settled.png") });

  console.log(`[indicator positions]`);
  console.log(`  before click (dashboard): x=${box0?.x.toFixed(1)}`);
  console.log(`  after 40ms:               x=${box40?.x.toFixed(1)}`);
  console.log(`  after 120ms:              x=${box120?.x.toFixed(1)}`);
  console.log(`  after 240ms:              x=${box240?.x.toFixed(1)}`);
  console.log(`  settled (clients):        x=${boxFinal?.x.toFixed(1)}`);

  // framer-motion handles the slide via JS (not CSS transition), so
  // transitionProperty may be "all" or absent — what we actually care
  // about is whether the position interpolated over time.
  console.log(`[diagnostic] transitionProperty=${meta.transitionProperty}, duration=${meta.transitionDuration}`);

  // Position must have moved between start and end
  if (box0 && boxFinal) {
    expect(Math.abs(boxFinal.x - box0.x)).toBeGreaterThan(20);
  }

  // KEY ASSERTION — at 40ms (~12% into 320ms slide), the indicator
  // should be partway between start and end, NOT already at final.
  if (box40 && boxFinal && box0) {
    const totalDelta = Math.abs(boxFinal.x - box0.x);
    const midDelta = Math.abs(box40.x - box0.x);
    const progressPct = (midDelta / totalDelta) * 100;
    console.log(`[diagnostic] mid-frame progress at 40ms: ${progressPct.toFixed(1)}% of total`);
    // Slide is working if progress at 40ms is < 80% (i.e., not instant)
    expect(progressPct).toBeLessThan(80);
  }
});

test("diagnose: prefers-reduced-motion check", async ({ page }) => {
  await page.goto("http://localhost:3000/login");
  const reducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  console.log(`[prefers-reduced-motion matches] ${reducedMotion}`);
});

test("diagnose: is the indicator the SAME DOM node before/after click?", async ({ page }) => {
  await realLogin(page);
  await page.waitForURL("**/dashboard");
  await page.waitForTimeout(500);

  // Tag the current indicator with a unique marker via JS
  const markerExisted = await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="mobile-bottom-nav"]');
    if (!nav) return { error: "no nav" };
    const indicator = nav.querySelector('div[aria-hidden="true"]');
    if (!indicator) return { error: "no indicator" };
    (indicator as HTMLElement).dataset.diagnosticMarker = "before-click-token-12345";
    const html = (indicator as HTMLElement).outerHTML;
    return { tagged: true, html };
  });
  console.log(`[BEFORE click — indicator tagged]`, markerExisted);

  // Also collect ALL inline transform values during a polling window
  await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="mobile-bottom-nav"]');
    const indicator = nav?.querySelector('div[aria-hidden="true"]') as HTMLElement | null;
    if (!indicator) return;
    const diagnosticWindow = window as DiagnosticWindow;
    diagnosticWindow.__indicatorFrames = [];
    const start = performance.now();
    const tick = () => {
      const t = performance.now() - start;
      if (t > 800) return;
      const el = document.querySelector('[data-slot="mobile-bottom-indicator"]') as HTMLElement | null;
      diagnosticWindow.__indicatorFrames?.push({
        t: Math.round(t),
        transform: el ? getComputedStyle(el).transform : null,
        inlineTransform: el?.style.transform ?? null,
        inlineStyleAttr: el?.getAttribute("style") ?? null,
        sameNode: el === indicator,
        markerStill: el?.dataset.diagnosticMarker ?? null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Click 고객 tab
  await page.locator('[data-slot="mobile-bottom-nav"] a[href="/clients"]').click();
  // Let polling collect ~800ms of frames
  await page.waitForTimeout(900);

  const frames = await page.evaluate((): IndicatorFrame[] => {
    return (window as DiagnosticWindow).__indicatorFrames ?? [];
  });
  console.log(`[INDICATOR FRAMES — looking for continuity + transition]`);
  for (const f of frames) {
    // Only show transitions: log every 8th frame plus all change frames
    const idx = frames.indexOf(f);
    if (idx % 8 !== 0 && idx !== 0 && idx !== (frames.length - 1)) continue;
    console.log(`  t=${String(f.t).padStart(4, " ")}ms same=${f.sameNode} computed=${f.transform} inline.transform=${JSON.stringify(f.inlineTransform)} inlineAttr.preview=${f.inlineStyleAttr?.slice(0, 120)}`);
  }

  const lostNodeFrame = frames.find((f) => f.sameNode === false);
  if (lostNodeFrame) {
    console.log(`\n>>> BUG IDENTIFIED: indicator DOM node was replaced at t=${lostNodeFrame.t}ms <<<`);
  } else {
    console.log(`\n>>> Indicator node persisted — checking if transform interpolated smoothly <<<`);
  }
});
