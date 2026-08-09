import { expect, type Page, test } from "@playwright/test";

/**
 * The call inbox is the only list page whose rows arrive from the server a page
 * at a time while the shared reveal hook walks them a screenful at a time. That
 * seam is invisible to jest — the unit tests mock the reveal hook outright — so
 * these specs drive the real one against mocked endpoints.
 *
 * Everything is stubbed at the route level: call records come out of an AI
 * ingestion pipeline that the e2e seed does not populate.
 */

const PAGE_SIZE = 20;
const DRAFT_TOTAL = 23;
const RECORD_TOTAL = 57;

const SUMMARY = "산후도우미 신규 문의, 출산예정일 9월 중순이라 일정 조율 원함";

type DraftFixture = {
  id: string;
  type: "NEW_CLIENT" | "CLIENT_UPDATE";
  status: string;
  requestSummary: string;
  callerName: string | null;
  callerPhone: string | null;
  recordedAt: string;
  createdAt: string;
  callRecordId: string;
  client: { id: number; name: string } | null;
  hasLowConfidence: boolean;
  possibleDuplicate: boolean;
  phoneMatchesExistingClient: boolean;
};

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function makeDraft(index: number, overrides: Partial<DraftFixture> = {}): DraftFixture {
  return {
    id: `draft-${index}`,
    type: "NEW_CLIENT",
    status: "PENDING",
    requestSummary: SUMMARY,
    callerName: `발신자${index}`,
    callerPhone: `0104821${String(index).padStart(4, "0")}`,
    recordedAt: isoAgo(index * 17 + 5),
    createdAt: isoAgo(index * 17 + 3),
    callRecordId: `rec-${index}`,
    client: null,
    hasLowConfidence: false,
    possibleDuplicate: false,
    phoneMatchesExistingClient: false,
    ...overrides,
  };
}

function makeRecord(index: number) {
  return {
    id: `rec-${index}`,
    callerName: `발신자${index}`,
    callerPhone: `0103331${String(index).padStart(4, "0")}`,
    category: "NEW_CONSULTATION",
    processingStatus: "PROCESSED",
    summaryLine: SUMMARY,
    recordedAt: isoAgo(index * 11 + 4),
    createdAt: isoAgo(index * 11 + 2),
    draft: null,
  };
}

function paginate<T>(rows: T[], url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  const limit = Number(url.searchParams.get("limit") ?? PAGE_SIZE);
  const start = (page - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    total: rows.length,
    page,
    limit,
    totalPages: Math.ceil(rows.length / limit) || 0,
  };
}

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/**
 * @returns a counter of how many times each list endpoint was asked for a page,
 *          so a spec can assert the page did not over-fetch.
 */
async function mockCallInbox(
  page: Page,
  {
    drafts = Array.from({ length: DRAFT_TOTAL }, (_, i) => makeDraft(i + 1)),
    records = Array.from({ length: RECORD_TOTAL }, (_, i) => makeRecord(i + 1)),
  }: { drafts?: DraftFixture[]; records?: ReturnType<typeof makeRecord>[] } = {},
) {
  const requestedPages = { drafts: [] as number[], records: [] as number[] };

  await page.route("**/api/auth/me", (route) =>
    route.fulfill(json({ id: "owner-1", name: "관리자", role: "owner" })),
  );
  await page.route("**/api/client-drafts/count**", (route) =>
    route.fulfill(json({ count: drafts.length })),
  );
  await page.route("**/api/client-drafts?**", (route) => {
    const url = new URL(route.request().url());
    requestedPages.drafts.push(Number(url.searchParams.get("page") ?? 1));
    return route.fulfill(json(paginate(drafts, url)));
  });
  await page.route("**/api/call-records?**", (route) => {
    const url = new URL(route.request().url());
    requestedPages.records.push(Number(url.searchParams.get("page") ?? 1));
    const search = url.searchParams.get("search");
    const filtered = search
      ? records.filter(
          (r) => (r.callerName ?? "").includes(search) || (r.callerPhone ?? "").includes(search),
        )
      : records;
    return route.fulfill(json(paginate(filtered, url)));
  });

  return requestedPages;
}

const rows = (page: Page) => page.locator(".list-item");
const loadMoreButton = (page: Page) => page.getByRole("button", { name: "더 많은 항목 불러오기" });

/** Reveals every row the list will give, one step at a time. */
async function revealAll(page: Page, cap = 20) {
  if (await loadMoreButton(page).isVisible().catch(() => false)) {
    await loadMoreButton(page).click();
  }
  let previous = -1;
  for (let i = 0; i < cap; i += 1) {
    const count = await rows(page).count();
    if (count === previous) break;
    previous = count;
    await rows(page).last().scrollIntoViewIfNeeded();
    // The sentinel loads on intersection; give it a beat to append and settle.
    await page.waitForTimeout(250);
  }
}

test.describe("Call inbox", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sits in the shell the same way the other list pages do", async ({ page }) => {
    await mockCallInbox(page);
    await page.goto("/calls");
    // Wait for a real row, not the loading skeleton: the skeleton also carries
    // .list-item, and the body class goes on in a passive effect, so a skeleton
    // can be on screen a frame before the shell class lands.
    await expect(page.locator('[data-component$="queue-list_row"]').first()).toBeVisible();

    // The shell only clamps main-content for routes that opt in by body class.
    // Without it the header spacing is 16px out and, worse, the sheet is free to
    // grow past the viewport so the list has nothing to scroll inside.
    const shell = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-slot="main-content"]')!;
      const sheet = document.querySelector<HTMLElement>(".mobile-detail-sheet")!;
      const nav = document.querySelector<HTMLElement>('[data-slot="mobile-bottom-nav"]');
      const mainStyle = getComputedStyle(main);
      return {
        mainPaddingTop: mainStyle.paddingTop,
        mainOverflowY: mainStyle.overflowY,
        sheetTop: Math.round(sheet.getBoundingClientRect().top),
        sheetBottom: Math.round(sheet.getBoundingClientRect().bottom),
        navPosition: nav ? getComputedStyle(nav).position : null,
        navBottom: nav ? Math.round(window.innerHeight - nav.getBoundingClientRect().bottom) : null,
        viewportHeight: window.innerHeight,
      };
    });

    expect(shell.mainPaddingTop).toBe("64px");
    expect(shell.mainOverflowY).toBe("hidden");
    expect(shell.sheetTop).toBe(64);
    // Clamped to the viewport rather than growing with the list.
    expect(shell.sheetBottom).toBeLessThanOrEqual(shell.viewportHeight);
    // The tab bar is pinned near the bottom, not pushed off the end of the page.
    expect(shell.navPosition).toBe("absolute");
    expect(shell.navBottom).toBeGreaterThanOrEqual(0);
    expect(shell.navBottom).toBeLessThan(40);
  });

  test("has its final layout on the first paint, before anything loads", async ({ page }) => {
    // The shell layout used to arrive with hydration, so the loading state drew
    // a taller header gap, a differently sized card and no tab bar, then
    // everything jumped. Keying the stylesheet on server markup rather than a
    // class an effect adds is what removes the jump — measure both ends.
    await mockCallInbox(page);
    await page.route("**/api/client-drafts?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return route.fulfill(json(paginate([], new URL(route.request().url()))));
    });

    const read = () =>
      page.evaluate(() => {
        const main = document.querySelector<HTMLElement>('[data-slot="main-content"]');
        const card = document.querySelector<HTMLElement>(".list-card");
        const nav = document.querySelector<HTMLElement>('[data-slot="mobile-bottom-nav"]');
        // .list-card runs a pop-up entry animation, so its own top is in motion
        // at first paint. Measure the box it sits in instead — that is what the
        // shell layout decides, and it is what was moving before.
        const content = document.querySelector<HTMLElement>('[data-slot="calls-content"]');
        return {
          mainPaddingTop: main ? getComputedStyle(main).paddingTop : null,
          mainOverflowY: main ? getComputedStyle(main).overflowY : null,
          contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
          contentHeight: content ? Math.round(content.getBoundingClientRect().height) : null,
          cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
          navPosition: nav ? getComputedStyle(nav).position : null,
          navOnScreen: nav ? nav.getBoundingClientRect().top < window.innerHeight : null,
        };
      });

    await page.goto("/calls", { waitUntil: "commit" });
    await page.waitForSelector('[data-slot="calls-content"]');
    const firstPaint = await read();

    await expect(page.locator('[data-component$="queue-empty"]')).toBeVisible({ timeout: 10_000 });
    const settled = await read();

    // Everything that decides the page's shape has to already be right.
    expect(firstPaint).toEqual(settled);
    expect(settled.mainPaddingTop).toBe("64px");
    expect(settled.navOnScreen).toBe(true);
  });

  test("draws skeleton rows the same height as the rows they stand in for", async ({ page }) => {
    // A call row stacks a badge over a timestamp, so its height comes from the
    // trailing column. A one-line placeholder there leaves the skeleton short
    // and the whole list shifts down the moment the data lands.
    await mockCallInbox(page);
    await page.route("**/api/client-drafts?**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return route.fulfill(
        json(paginate(Array.from({ length: DRAFT_TOTAL }, (_, i) => makeDraft(i + 1)), new URL(route.request().url()))),
      );
    });

    const rowMetrics = () =>
      page.evaluate(() => {
        const row = document.querySelector<HTMLElement>(".list-item");
        const right = row?.querySelector<HTMLElement>(".list-right");
        return {
          height: row ? Math.round(row.getBoundingClientRect().height) : null,
          rightHeight: right ? Math.round(right.getBoundingClientRect().height) : null,
        };
      });

    await page.goto("/calls");
    await expect(page.locator('[data-component$="queue-skeleton"]')).toBeVisible();
    const skeleton = await rowMetrics();

    await expect(page.locator('[data-component$="queue-list_row"]').first()).toBeVisible({
      timeout: 10_000,
    });
    const loaded = await rowMetrics();

    expect(skeleton).toEqual(loaded);
  });

  test("scrolls the list inside the card rather than the page", async ({ page }) => {
    await mockCallInbox(page);
    await page.goto("/calls");
    await expect(loadMoreButton(page)).toBeVisible();
    await loadMoreButton(page).click();
    await expect(loadMoreButton(page)).toBeHidden();

    const scroller = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".mobile-app-root *")].find(
        (node) =>
          node.scrollHeight > node.clientHeight + 4 &&
          ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
      );
      return el ? { dc: el.getAttribute("data-component"), overflow: el.scrollHeight - el.clientHeight } : null;
    });

    expect(scroller).not.toBeNull();
    expect(scroller!.dc).toContain("list-card_body");
    expect(scroller!.overflow).toBeGreaterThan(0);
  });

  test("shows a teaser of the queue with a tap-to-expand affordance", async ({ page }) => {
    await mockCallInbox(page);
    await page.goto("/calls");

    await expect(page.getByText("통화 인박스")).toBeVisible();
    // The reveal starts with what fits on screen plus one peek row, never the
    // whole page of 20 the server sent.
    const initial = await rows(page).count();
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(PAGE_SIZE);
    await expect(loadMoreButton(page)).toBeVisible();
  });

  test("keeps the triage flags visible when the caller line is too long to fit", async ({ page }) => {
    await mockCallInbox(page, {
      drafts: [
        makeDraft(1, {
          callerName: "황보라영김수한무거북이두루미",
          callerPhone: "01098765432",
          hasLowConfidence: true,
          possibleDuplicate: true,
        }),
      ],
    });
    await page.goto("/calls");
    await expect(rows(page)).toHaveCount(1);

    // toBeVisible() is not enough, and neither is comparing against the row:
    // .list-name is the box that clips, and it sits well inside the row's right
    // edge, so a flag can be cut off and still land inside the row. Assert on
    // the clipping box itself.
    const geometry = await page.evaluate(() => {
      const name = document.querySelector<HTMLElement>(".list-item .list-name")!;
      const flags = [...name.querySelectorAll("span")].slice(1);
      return {
        overflows: name.scrollWidth > name.clientWidth,
        nameRight: name.getBoundingClientRect().right,
        flagRights: flags.map((f) => f.getBoundingClientRect().right),
      };
    });

    expect(geometry.overflows).toBe(false);
    expect(geometry.flagRights).toHaveLength(2);
    for (const right of geometry.flagRights) {
      expect(right).toBeLessThanOrEqual(geometry.nameRight + 1);
    }
    await expect(page.getByText("확신도 낮음")).toBeVisible();
    await expect(page.getByText("중복 가능")).toBeVisible();
  });

  test("walks the whole queue across server pages without repeating a row", async ({ page }) => {
    const requested = await mockCallInbox(page);
    await page.goto("/calls");
    await expect(loadMoreButton(page)).toBeVisible();

    await revealAll(page);

    await expect(rows(page)).toHaveCount(DRAFT_TOTAL);
    // 23 drafts is two server pages; asking for either one twice would mean the
    // effect fired on a state it had already handled.
    expect(requested.drafts).toEqual([1, 2]);

    const names = await rows(page).locator(".list-name").allInnerTexts();
    expect(new Set(names).size).toBe(names.length);
  });

  test("stops fetching once the list is exhausted", async ({ page }) => {
    const requested = await mockCallInbox(page, {
      drafts: Array.from({ length: 3 }, (_, i) => makeDraft(i + 1)),
    });
    await page.goto("/calls");
    await expect(rows(page)).toHaveCount(3);

    await revealAll(page);
    await page.waitForTimeout(600);

    expect(requested.drafts).toEqual([1]);
    await expect(loadMoreButton(page)).toBeHidden();
  });

  test("does not hammer the server when a page fails to load", async ({ page }) => {
    let draftCalls = 0;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill(json({ id: "owner-1", name: "관리자", role: "owner" })),
    );
    await page.route("**/api/client-drafts/count**", (route) =>
      route.fulfill(json({ count: DRAFT_TOTAL })),
    );
    await page.route("**/api/call-records?**", (route) => route.fulfill(json(paginate([], new URL(route.request().url())))));
    await page.route("**/api/client-drafts?**", (route) => {
      const url = new URL(route.request().url());
      draftCalls += 1;
      if (Number(url.searchParams.get("page") ?? 1) > 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      }
      return route.fulfill(
        json(paginate(Array.from({ length: DRAFT_TOTAL }, (_, i) => makeDraft(i + 1)), url)),
      );
    });

    await page.goto("/calls");
    await expect(loadMoreButton(page)).toBeVisible();
    await revealAll(page);
    await page.waitForTimeout(1500);

    // Retrying is allowed — the reveal moving on is the user asking again, and
    // page 2 is retried once per step, so the count is bounded by how far the
    // reveal walked. What must never happen is the effect firing on its own.
    const afterReveal = draftCalls;
    expect(afterReveal).toBeLessThan(DRAFT_TOTAL);

    // Nothing touches the page from here; an unguarded effect would keep
    // re-firing because a failure leaves hasNextPage true and clears
    // isFetchingNextPage without changing anything else it reads.
    await page.waitForTimeout(2000);
    expect(draftCalls).toBe(afterReveal);

    // Whatever did arrive stays on screen.
    expect(await rows(page).count()).toBeGreaterThan(0);
  });

  test("switches to the call log and searches it", async ({ page }) => {
    await mockCallInbox(page);
    await page.goto("/calls");

    await page.getByRole("button", { name: /통화 기록/ }).click();
    await expect(rows(page).first()).toBeVisible();

    await page.getByPlaceholder("이름, 전화번호 검색").fill("발신자7");
    await expect(rows(page).first()).toContainText("발신자7");
  });

  test("keeps the log on screen while a filter or search reloads it", async ({ page }) => {
    // The category and search terms are part of the server query key, so each
    // change starts a fresh query. Every other list page filters in memory and
    // never blanks; without keepPreviousData this one drops to a skeleton on
    // every keystroke.
    await mockCallInbox(page);
    await page.route("**/api/call-records?**", async (route) => {
      const url = new URL(route.request().url());
      const search = url.searchParams.get("search");
      const all = Array.from({ length: RECORD_TOTAL }, (_, i) => makeRecord(i + 1));
      const filtered = search ? all.filter((r) => r.callerName.includes(search)) : all;
      // Slow enough that a skeleton would be caught if one were rendered.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill(json(paginate(filtered, url)));
    });

    await page.goto("/calls");
    await page.getByRole("button", { name: /통화 기록/ }).click();
    // A real row, not rows(): the loading skeleton carries .list-item too, so
    // waiting on that would start the watch while the first query is still in
    // flight and catch its skeleton rather than a filter-induced one.
    await expect(page.locator('[data-component$="log-list_row"]').first()).toBeVisible();

    const skeleton = page.locator('[data-component$="-skeleton"]');

    // Sample continuously across the reload rather than checking once after it
    // settles — the skeleton would only be on screen while the query is in
    // flight, which is exactly the window a single assertion would miss.
    const watchForSkeleton = async (durationMs: number) => {
      let sawSkeleton = false;
      const deadline = Date.now() + durationMs;
      while (Date.now() < deadline) {
        if ((await skeleton.count()) > 0) sawSkeleton = true;
        await page.waitForTimeout(40);
      }
      return sawSkeleton;
    };

    const categoryPromise = watchForSkeleton(900);
    await page.getByRole("button", { name: /^신규상담/ }).click();
    expect(await categoryPromise).toBe(false);

    const searchPromise = watchForSkeleton(900);
    await page.getByPlaceholder("이름, 전화번호 검색").fill("발신자7");
    expect(await searchPromise).toBe(false);

    // The rows still update once the new query lands.
    await expect(rows(page).first()).toContainText("발신자7");
  });

  test("shows the empty state for each tab", async ({ page }) => {
    await mockCallInbox(page, { drafts: [], records: [] });
    await page.goto("/calls");

    await expect(page.getByText("검토할 통화가 없습니다")).toBeVisible();

    await page.getByRole("button", { name: /통화 기록/ }).click();
    await expect(page.getByText("통화 기록이 없습니다")).toBeVisible();
  });
});
