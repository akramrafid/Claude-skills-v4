---
name: frontend-engineering
description: Role 10 (Build hat) - frontend engineer. Builds the Next.js App Router UI on the real API (types generated from contracts/openapi.json, openapi-fetch, TanStack Query, SSE streaming with Stop), implements every screen from docs/ux with empty, loading, error and success states and the agreed data-testid names, renders model output safely, meets WCAG 2.2 AA, and ships Vercel-ready config. Proves it with Playwright end-to-end tests of the happy path and the error states (500, 429, network failure, timeout, empty data) plus an axe accessibility scan. Full patterns in references/nextjs-patterns.md. Use for any UI work. Done check - node .orca-team/tools/gates.mjs e2e.
---

# Frontend Engineering — Role 10 · Build hat

**Seat:** UI (models: `swarm-lead/references/model-routing.md`); UI-2 can take a second feature in parallel. **Independent check:**
REVIEWER-CODE (Claude, cross-family) reviews every round; OUTSIDER re-runs the hallway test on the running app.
**Hand-off:** your slice — `apps/web/src/features/<name>/`, its routes in `src/app/`, and
`apps/web/e2e/<name>*.spec.ts` (layout: `references/nextjs-patterns.md` §2). **Done when:** `node .orca-team/tools/gates.mjs e2e`
(runs `npm run e2e`) passes, plus lint, typecheck and build.

Read `references/nextjs-patterns.md` (scaffold, typed client, SSE, safe Markdown, four states, headers).

## Rules
1. **Real API from day one** — stubs from LEAD's skeleton return schema-valid data; real data arrives as CORE
   merges. Types come from `npm run api:types`; never hand-write API types.
2. **Screens = `docs/ux/wireframes.md`** — same copy, same four states, same `data-testid` names.
3. **Design direction** from PLAN.md (one palette, one type pairing) via `frontend-design`; audit with
   `web-design-guidelines` before `worker_done`.
4. **Safe output** — sanitised Markdown, images from model output dropped, no `dangerouslySetInnerHTML`.
5. **No secrets in the browser.** `NEXT_PUBLIC_*` is public and baked in at build time. Anything secret →
   a Next route handler that calls the API server-side.
6. **Vercel-ready** — `NEXT_PUBLIC_API_BASE_URL` validated with zod at startup; security headers in
   `next.config.ts`; images via `next/image`; fonts via `next/font`.

## Playwright setup (`apps/web`)
```
npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium
```
`package.json`: `"e2e": "playwright test"`.
```ts
// apps/web/playwright.config.ts — boots API (test mode: mock LLM, test DB) + web on fixed test ports
import { defineConfig } from "@playwright/test";
const API = "http://127.0.0.1:8011";
export default defineConfig({
  testDir: "./e2e",
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3011", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "npm --prefix ../.. run dev:api:test", url: `${API}/healthz`, timeout: 120_000, reuseExistingServer: !process.env.CI },
    { command: "npx next dev -p 3011", url: "http://127.0.0.1:3011", timeout: 120_000,
      reuseExistingServer: !process.env.CI, env: { NEXT_PUBLIC_API_BASE_URL: API } },
  ],
});
```
```ts
// apps/web/e2e/core-flow.spec.ts — the golden path, named after PRD acceptance criteria
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("AC-1 asks a question and gets a cited answer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("ask-input").fill("How much credit do I get for a 30 hour outage?");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("answer")).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.getByTestId("citation-1")).toBeVisible();
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
});
```
```ts
// apps/web/e2e/error-states.spec.ts — the UI must stay honest when the API is not
import { test, expect } from "@playwright/test";
const problem = (status: number, title: string) => ({ status, contentType: "application/problem+json",
  body: JSON.stringify({ type: "about:blank", title, status, detail: "", request_id: "test-rid" }) });

test("AC-2 server error shows retry and request id", async ({ page }) => {
  await page.route("**/api/v1/**", r => r.fulfill(problem(502, "Upstream model unavailable")));
  await page.goto("/"); await page.getByTestId("ask-input").fill("hi"); await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-retry")).toBeVisible();
  await expect(page.getByText("test-rid")).toBeVisible();
});
test("rate limited shows wait message", async ({ page }) => {
  await page.route("**/api/v1/**", r => r.fulfill({ ...problem(429, "Too many requests"), headers: { "Retry-After": "10" } }));
  /* … assert a friendly 'try again in 10 s' message, button disabled … */
});
test("network failure", async ({ page }) => { await page.route("**/api/v1/**", r => r.abort("failed")); /* … */ });
test("empty state", async ({ page }) => { await page.goto("/"); await expect(page.getByTestId("example-1")).toBeVisible(); });
```
Also cover: slow response (fulfil after a delay > the client timeout → timeout message, Stop works) and
validation errors (422 → field message). No `waitForTimeout`; wait on test IDs.

## The check
`gates.mjs e2e` runs `npm run e2e`. Paste the Playwright summary in your report; failures keep their trace
and screenshot in `apps/web/test-results/` (gitignored).

## Pair with
`frontend-design` · `vercel-react-best-practices` · `web-design-guidelines` · `webapp-testing` (manual
screenshots) · `verification-before-completion`.

## Anti-patterns
Only testing the happy path · spinners with no text · errors that say "Something went wrong" with no next
step · hand-written API types · secrets or provider SDKs in the browser · layout that breaks at 375 px.
