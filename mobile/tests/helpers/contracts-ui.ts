import { expect, type Page } from "@playwright/test";

/**
 * Clicks a contracts section tab and waits until the page reports it selected.
 *
 * A bare click here is a race. The tab paints from the server-rendered markup, so a
 * click that lands before React attaches its handler is swallowed with no error at
 * all: the section never switches, and the test fails thirty seconds later on
 * whatever row it expected the section to contain. That is the shape
 * `contracts-mobile-list-row.spec.ts` "confirms a service record review without
 * requesting an end date" failed with in CI — a timeout on the 검토고객 row, two
 * lines after the 제공기록지 click that was supposed to reveal it.
 *
 * Retrying the whole click is what makes it deterministic; asserting harder on the
 * result of one swallowed click cannot. `aria-pressed` is the page's own record of
 * which section is active, so it serves as both the retry condition and the proof
 * the click took effect. The guard is not redundant with the assertion after it:
 * the tabs are a selection group, and re-clicking an already-selected tab re-runs
 * its queries for no reason.
 */
export async function selectContractsSection(page: Page, name: string) {
  const tab = page.getByRole("button", { name, exact: true });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    if ((await tab.getAttribute("aria-pressed")) !== "true") {
      await tab.click();
    }
    await expect(tab).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return tab;
}
