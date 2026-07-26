import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Dense capture: 25 screenshots of the mobile-bottom-nav at 8ms intervals
 * (covering 0-200ms) during a tab change.
 *
 * Drives the user's running pnpm dev server at http://localhost:3000 via the
 * real /login flow (no E2E shortcut cookies).
 */

const OUT = path.join(__dirname, "screenshots", "nav-broken-diagnose");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "wlsghtmeod@gmail.com";
const PASSWORD = "Test1234!";

interface NavSample {
  t: number;
  x: number | null;
  width: number | null;
}

type DiagnosticWindow = Window & typeof globalThis & {
  __navStart?: number;
  __navSamples?: NavSample[];
};

test.use({
  viewport: { width: 375, height: 812 },
  storageState: { cookies: [], origins: [] }, // force real login
});

async function realLogin(page: Page): Promise<{ rateLimited: boolean }> {
  await page.goto("http://localhost:3000/login");
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);

  // Watch for 429 on the login response.
  let rateLimited = false;
  const responsePromise = page
    .waitForResponse(
      (resp) => resp.url().includes("/login") || resp.url().includes("/auth"),
      { timeout: 15000 }
    )
    .catch(() => null);

  await page.click('[data-component="login-submit-button"]');
  const resp = await responsePromise;
  if (resp && resp.status() === 429) {
    rateLimited = true;
    return { rateLimited };
  }

  await page.waitForURL(/\/(select-branch|dashboard)/, { timeout: 15000 });
  if (page.url().includes("select-branch")) {
    await page.click('[data-component="select-branch-row"]', { timeout: 10000 });
    await page.waitForTimeout(300);
    const btn = page.locator(".branch-actions .branch-btn").first();
    await btn.click();
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  }
  return { rateLimited: false };
}

async function loginWithRetry(page: Page): Promise<boolean> {
  const first = await realLogin(page);
  if (!first.rateLimited) return true;
  console.log("[login] hit 429 rate limit — sleeping 60s then retrying once");
  await page.waitForTimeout(60_000);
  const second = await realLogin(page);
  if (second.rateLimited) {
    console.log("[login] still rate-limited after retry — giving up");
    return false;
  }
  return true;
}

test("dense nav slide capture: 25 frames @ 8ms across tab change", async ({ page }) => {
  const ok = await loginWithRetry(page);
  if (!ok) {
    test.skip(true, "rate limited (429) after retry — cannot run dense capture");
    return;
  }

  await page.waitForURL("**/dashboard");
  await page.waitForTimeout(600);

  const nav = page.locator('[data-slot="mobile-bottom-nav"]');
  await expect(nav).toBeVisible();
  // Give framer-motion a beat to settle the initial indicator layoutId.
  await page.waitForTimeout(200);

  // --- Baseline ---
  await nav.screenshot({ path: path.join(OUT, "00-baseline.png") });

  // Resolve nav bounding box for the cropped screenshots.
  const navBox = await nav.boundingBox();
  if (!navBox) throw new Error("could not measure nav box");
  const clip = {
    x: Math.floor(navBox.x),
    y: Math.floor(navBox.y),
    width: Math.ceil(navBox.width),
    height: Math.ceil(navBox.height),
  };

  // --- Click the 고객 tab and start the dense capture loop immediately ---
  const clientsTab = page.locator('[data-slot="mobile-bottom-nav-clients"]');

  // Prime the page-side position tracker BEFORE clicking so the first samples
  // come as soon as possible after the click.
  await page.evaluate(() => {
    const diagnosticWindow = window as DiagnosticWindow;
    diagnosticWindow.__navStart = 0;
    diagnosticWindow.__navSamples = [];
  });

  // Kick off the click + a 200ms position-sampling loop running in the page,
  // and in parallel capture 25 screenshots from the test side every 8ms.
  const startSampling = page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const start = performance.now();
      const diagnosticWindow = window as DiagnosticWindow;
      diagnosticWindow.__navStart = start;
      const tick = () => {
        const t = performance.now() - start;
        const el = document.querySelector(
          '[data-slot="mobile-bottom-indicator"]'
        ) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          diagnosticWindow.__navSamples?.push({ t, x: r.x, width: r.width });
        } else {
          diagnosticWindow.__navSamples?.push({ t, x: null, width: null });
        }
        if (t >= 208) {
          resolve();
          return;
        }
        setTimeout(tick, 8);
      };
      tick();
    });
  });

  // Click in parallel — race the JS click against the sampling start.
  const clickPromise = clientsTab.click({ noWaitAfter: true });

  // Test-side screenshot pacing: 25 frames at ~8ms intervals.
  const screenshotPromises: Array<Promise<unknown>> = [];
  const t0 = Date.now();
  for (let i = 1; i <= 25; i++) {
    const targetT = i * 8; // ms after click
    const wait = targetT - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const name = `${String(i).padStart(2, "0")}-t${String(targetT).padStart(3, "0")}ms.png`;
    screenshotPromises.push(
      page.screenshot({ path: path.join(OUT, name), clip }).catch((err) => {
        console.log(`[screenshot ${name}] failed: ${err.message ?? err}`);
      })
    );
  }

  await Promise.all([clickPromise, startSampling, ...screenshotPromises]);

  // --- Settled frame ---
  await page.waitForTimeout(300);
  await nav.screenshot({ path: path.join(OUT, "26-settled.png") });

  // Dump indicator position samples for the structured report.
  const samples = await page.evaluate((): NavSample[] => {
    return (window as DiagnosticWindow).__navSamples ?? [];
  });
  console.log(`[indicator samples — ${samples.length} entries]`);
  for (const s of samples) {
    console.log(
      `  t=${s.t.toFixed(1).padStart(6, " ")}ms  x=${
        s.x === null ? "null" : s.x.toFixed(1)
      }  w=${s.width === null ? "null" : s.width.toFixed(1)}`
    );
  }

  // Write samples to disk so the orchestrator can ingest them too.
  fs.writeFileSync(
    path.join(OUT, "samples.json"),
    JSON.stringify(samples, null, 2)
  );
});
