#!/usr/bin/env node
// gates — the runnable "done" check of every hackathon role (16 roles, 5 hats) + merge and promote gates.
//
//   node .orca-team/tools/gates.mjs list                     what each gate checks and who owns it
//   node .orca-team/tools/gates.mjs <id> [<id> ...]          run some gates, e.g.  prd adr contract
//   node .orca-team/tools/gates.mjs hat <frame|design|build|prove|ship>
//   node .orca-team/tools/gates.mjs all                      every gate → .orca-team/GATES.md
//   node .orca-team/tools/gates.mjs merge <branch>           review file + no-commit merge + npm run ci → commit or abort
//   node .orca-team/tools/gates.mjs promote                  all gates (strict) + review verdicts → ready for main?
//   add --strict to make the prd gate require a test for every MUST acceptance criterion.
//
// Statuses: PASS · WARN (passes, but read it) · SKIP (marked not applicable in gates.json) · FAIL · BLOCKED
// (a tool or input is missing). Exit code 1 if any selected gate is FAIL or BLOCKED.
// Thresholds and commands: .orca-team/gates.json. Never prints secret values.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = gitOut(["rev-parse", "--show-toplevel"]);
if (!ROOT) { console.error("gates: run inside the project git repository"); process.exit(1); }
const CFG = loadConfig();
const T = CFG.thresholds;

// ---------- helpers ----------
function gitOut(args, cwd = process.cwd()) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function gitOk(args, cwd = ROOT) {
  return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}
function loadConfig() {
  const defaults = {
    thresholds: { recall_at_k: 0.8, retrieval_min_queries: 20, eval_threshold: 0.8, eval_min_heldout: 30,
      eval_max_regression: 0.05, redteam_min_pass: 0.95, redteam_min_attacks: 25, dry_run_min: 80, max_must: 5 },
    commands: { ci: "npm run ci", migrations: "npm run db:check", contract: "npm run test:contract", e2e: "npm run e2e",
      eval: "npm run eval", retrieval: "npm run eval:retrieval", load: "npm run load", redteam: "npm run redteam",
      traces: "npm run check:traces", bootstrap: "npm run bootstrap" },
    timeouts_min: { default: 15 }, gitleaks_required: true, skip: {},
  };
  const file = path.join(ROOT, ".orca-team", "gates.json");
  if (!fs.existsSync(file)) return defaults;
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  return { ...defaults, ...c, thresholds: { ...defaults.thresholds, ...c.thresholds },
    commands: { ...defaults.commands, ...c.commands }, timeouts_min: { ...defaults.timeouts_min, ...c.timeouts_min } };
}
const read = (rel) => { const f = path.join(ROOT, rel); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; };
const readJson = (rel) => { const t = read(rel); if (t === null) return null; try { return JSON.parse(t); } catch { return undefined; } };
function section(md, heading) {
  // text under "## <heading...>" until the next "## " heading (case-insensitive prefix match)
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").toLowerCase().startsWith(heading.toLowerCase()));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}
function table(text) {
  // first markdown table in text → { header: [...], rows: [[...]] }
  const lines = (text ?? "").split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { header: [], rows: [] };
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).filter((l) => !/^\|?\s*:?-{2,}/.test(l.trim())).map(cells);
  return { header, rows };
}
const col = (header, name) => header.findIndex((h) => h.includes(name));
function walk(relDir, exts, out = []) {
  const dir = path.join(ROOT, relDir);
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".venv", ".git", ".next", "__pycache__", ".cache", "test-results", "playwright-report"].includes(e.name)) continue;
    const rel = path.join(relDir, e.name);
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}
function family(model) {
  const m = String(model ?? "").toLowerCase();
  if (!m.trim()) return "";
  const map = [["anthropic", /claude|opus|sonnet|haiku|fable|mythos|\bbest\b|ag_opus|ag_sonnet/], ["google", /gemini|neon|hydrogen|argon|carbon|g_pro|g_flash|gemma/],
    ["openai", /gpt|\bo[134]\b|o[134]-|openai/], ["zhipu", /glm/], ["moonshot", /kimi/], ["qwen", /qwen/], ["deepseek", /deepseek/],
    ["minimax", /minimax/], ["xai", /grok/], ["meta", /llama|muse|wonder/], ["mistral", /mistral|codestral/], ["opencode", /opencode/]];
  for (const [f, re] of map) if (re.test(m)) return f;
  return m.split(/[\/\s:]/)[0];
}
function runCmd(cmd, gateId, cwd = ROOT) {
  const minutes = CFG.timeouts_min[gateId] ?? CFG.timeouts_min.default ?? 15;
  console.log(`\n  $ ${cmd}   (timeout ${minutes} min)`);
  const r = spawnSync(cmd, { cwd, shell: true, stdio: "inherit", timeout: minutes * 60_000 });
  if (r.error && r.error.code === "ETIMEDOUT") return { code: 124, timedOut: true };
  return { code: r.status ?? 1, timedOut: false };
}
const hasTool = (bin, args = ["--version"]) => spawnSync(bin, args, { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
const res = (status, ...detail) => ({ status, detail: detail.flat().filter(Boolean) });
const parseVerdict = (t) => (t.match(/Verdict:\s*([A-Z-]+)/i) || [])[1]?.toUpperCase() ?? "";

// ---------- gates ----------
function gatePrd(opts) {
  const prd = read("docs/PRD.md");
  if (prd === null) return res("FAIL", "docs/PRD.md missing (skill product-requirements)");
  const fails = [], warns = [];
  const rubric = new Set(table(section(prd, "Rubric")).rows.map((r) => r[0]).filter((x) => /^R\d+$/.test(x)));
  if (!rubric.size) fails.push("## Rubric table with ids R1..Rn not found");
  const req = table(section(prd, "Requirements"));
  const [iId, iPri, iRub, iAc] = [col(req.header, "id"), col(req.header, "priority"), col(req.header, "rubric"), col(req.header, "accept")];
  if ([iId, iPri, iRub, iAc].some((i) => i < 0)) fails.push("## Requirements table needs columns ID | Priority | Story | Rubric | Acceptance");
  const acText = section(prd, "Acceptance criteria") ?? "";
  const acOk = new Map();
  for (const line of acText.split(/\r?\n/)) {
    for (const id of line.match(/AC-\d+/g) ?? []) if (!acOk.has(id)) acOk.set(id, /given/i.test(line) && /when/i.test(line) && /then/i.test(line));
  }
  const musts = [], covered = new Set();
  if (iId >= 0 && iPri >= 0 && iRub >= 0 && iAc >= 0) {
    for (const r of req.rows) {
      const pri = (r[iPri] ?? "").toUpperCase(), refs = (r[iRub] ?? "").match(/R\d+/g) ?? [], acs = (r[iAc] ?? "").match(/AC-\d+/g) ?? [];
      if (pri === "MUST" || pri === "SHOULD") refs.forEach((x) => covered.add(x));
      if (pri !== "MUST") continue;
      musts.push({ id: r[iId], acs });
      if (!refs.length) fails.push(`${r[iId]}: MUST without a rubric line`);
      for (const x of refs) if (!rubric.has(x)) fails.push(`${r[iId]}: rubric ${x} not in ## Rubric`);
      if (!acs.length) fails.push(`${r[iId]}: MUST without acceptance criteria`);
      if (acs.length === 1) warns.push(`${r[iId]}: only one AC — add a failure-path AC`);
      for (const a of acs) {
        if (!acOk.has(a)) fails.push(`${r[iId]}: ${a} not defined under ## Acceptance criteria`);
        else if (!acOk.get(a)) fails.push(`${a}: not in Given/When/Then form`);
      }
    }
  }
  if (!musts.length) fails.push("no MUST requirements");
  if (musts.length > T.max_must) warns.push(`${musts.length} MUSTs (max ${T.max_must}) — cut scope`);
  for (const x of rubric) if (!covered.has(x)) warns.push(`rubric ${x} not covered by any MUST/SHOULD`);
  if (section(prd, "Demo script") === null) fails.push("## Demo script section missing");
  if (section(prd, "Non-functional") === null) warns.push("## Non-functional requirements section missing");
  // traceability: every MUST AC referenced by a test, eval case or e2e spec
  const files = [...walk("apps/api/tests", [".py"]), ...walk("apps/web/e2e", [".ts", ".tsx"]), ...walk("apps/api/evals/datasets", [".jsonl"])];
  const corpus = files.map((f) => read(f) ?? "").join("\n");
  const untested = musts.flatMap((m) => m.acs).filter((a) => !new RegExp(`(?<![a-z0-9])ac[-_ ]?${a.slice(3)}(?![0-9])`, "i").test(corpus));
  if (untested.length) (opts.strict ? fails : warns).push(`MUST ACs without a test/eval/e2e referencing them: ${untested.join(", ")}`);
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns, `${musts.length} MUST · ${rubric.size} rubric lines · ${acOk.size} ACs`);
}

function gateUx() {
  const fails = [], warns = [];
  const flow = read("docs/ux/flow.md");
  if (flow === null || !flow.includes("```mermaid")) fails.push("docs/ux/flow.md with a mermaid flow missing");
  const wf = read("docs/ux/wireframes.md");
  if (wf === null) fails.push("docs/ux/wireframes.md missing");
  else {
    const screens = wf.split(/^###\s+Screen:/m).slice(1);
    if (!screens.length) fails.push("no '### Screen:' sections in wireframes.md");
    screens.forEach((s) => {
      const name = s.split(/\r?\n/)[0].trim();
      const missing = ["empty", "loading", "error", "success"].filter((st) => !new RegExp(`\\b${st}\\b`, "i").test(s));
      if (missing.length) fails.push(`screen "${name}": missing states ${missing.join(", ")}`);
      if (!/testid|`[a-z0-9]+(-[a-z0-9<>]+)+`/i.test(s)) warns.push(`screen "${name}": no data-testid names`);
    });
  }
  const ht = read("docs/ux/hallway-test.md");
  if (ht === null) fails.push("docs/ux/hallway-test.md missing (outsider test)");
  else {
    if (!/Result:\s*PASS/i.test(ht)) fails.push("hallway test Result is not PASS");
    const a = family((ht.match(/Author:\s*([^·\n]+)/i) || [])[1]), t = family((ht.match(/Tester:\s*([^·\n]+)/i) || [])[1]);
    if (!a || !t) fails.push("hallway test needs 'Author:' and 'Tester:' lines");
    else if (a === t) fails.push(`tester family (${t}) must differ from author family (${a})`);
    if (!/running app/i.test((ht.match(/Material:\s*([^\n]+)/i) || [])[1] ?? "")) warns.push("hallway test was on wireframes only — repeat on the running app before freeze");
  }
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns);
}

function gateAdr() {
  const fails = [], warns = [];
  const arch = read("docs/architecture.md");
  if (arch === null) fails.push("docs/architecture.md missing");
  else if ((arch.match(/```mermaid/g) ?? []).length < 2) fails.push("architecture.md needs C4 context + container diagrams (2 mermaid blocks)");
  const adrs = walk("docs/adr", [".md"]);
  if (!adrs.length) fails.push("no ADRs in docs/adr/");
  for (const f of adrs) {
    const t = read(f);
    for (const h of ["Status", "Context", "Decision", "Consequences"]) if (section(t, h) === null) fails.push(`${f}: missing ## ${h}`);
    const rej = section(t, "Rejected") ?? section(t, "Alternatives");
    if (rej === null) fails.push(`${f}: missing ## Rejected options`);
    else if (!/^\s*[-*]\s+\S/m.test(rej)) fails.push(`${f}: Rejected options has no list item`);
  }
  if (adrs.length && adrs.length < 4) warns.push(`only ${adrs.length} ADRs — mandatory set covers deploy/state, LLM+fallback, vector store, embeddings, streaming, auth, ingestion, data fetching`);
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns, `${adrs.length} ADRs`);
}

function gateContracts() {
  const fails = [], warns = [];
  const oa = readJson("contracts/openapi.json");
  if (!oa) fails.push("contracts/openapi.json missing or invalid (npm run contracts)");
  else if (!Object.keys(oa.paths ?? {}).length) fails.push("openapi.json has no paths");
  if (!CFG.skip.migrations) {
    if (!walk("apps/api/migrations/versions", [".py"]).length) fails.push("no Alembic revision in apps/api/migrations/versions (DB schema not locked)");
  }
  if (!CFG.skip.eval) {
    let n = 0, noSplit = 0;
    for (const f of walk("apps/api/evals/datasets", [".jsonl"]).filter((f) => !f.endsWith("retrieval.jsonl"))) {
      for (const l of (read(f) ?? "").split(/\r?\n/)) if (l.trim()) { n++; try { if (!JSON.parse(l).split) noSplit++; } catch { noSplit++; } }
    }
    if (n < 30) fails.push(`eval set has ${n} cases (need ≥ 30 before build)`);
    if (noSplit) fails.push(`${noSplit} eval cases without a valid "split"`);
  }
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns);
}

// ADR-0001: vertical slices — a feature never imports another feature; services stay framework-free
function gateSlices() {
  const fails = [], warns = [];
  const API = "apps/api/app/features", WEB = "apps/web/src/features";
  const apiFeats = fs.existsSync(path.join(ROOT, API)) ? fs.readdirSync(path.join(ROOT, API), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name) : [];
  const webFeats = fs.existsSync(path.join(ROOT, WEB)) ? fs.readdirSync(path.join(ROOT, WEB), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  if (!apiFeats.length) warns.push(`no ${API}/<name>/ folders — ADR-0001 expects one vertical slice per MUST capability`);
  const lineOf = (src, i) => src.slice(0, i).split("\n").length;
  const FRAMEWORK = /^\s*(?:from|import)\s+(fastapi|starlette|sqlalchemy|openai|anthropic|qdrant_client|httpx|asyncpg|psycopg|requests)\b/gm;
  for (const feat of apiFeats) {
    for (const f of walk(`${API}/${feat}`, [".py"])) {
      const src = read(f) ?? "";
      for (const m of src.matchAll(/^\s*(?:from|import)\s+app\.features\.(\w+)/gm))
        if (m[1] !== feat) fails.push(`${f}:${lineOf(src, m.index)} imports feature "${m[1]}" — move shared logic to app/shared/`);
      for (const m of src.matchAll(/^\s*from\s+\.\.(\w+)/gm))
        if (apiFeats.includes(m[1]) && m[1] !== feat) fails.push(`${f}:${lineOf(src, m.index)} imports feature "${m[1]}" (relative)`);
      if (/[\\/]service\.py$/.test(f)) for (const m of src.matchAll(FRAMEWORK))
        fails.push(`${f}:${lineOf(src, m.index)} service imports ${m[1]} — depend on app.ports, put SDK/ORM code in app/adapters/`);
      if (/[\\/]router\.py$/.test(f) && /^\s*(?:from|import)\s+(openai|anthropic|qdrant_client|sqlalchemy)\b/m.test(src))
        fails.push(`${f}: router talks to an SDK/ORM directly — go through the service`);
    }
  }
  for (const feat of webFeats) {
    for (const f of walk(`${WEB}/${feat}`, [".ts", ".tsx"])) {
      const src = read(f) ?? "";
      for (const m of src.matchAll(/from\s+["'](?:@\/features\/|(?:\.\.\/)+features\/|\.\.\/)([\w-]+)/g))
        if (webFeats.includes(m[1]) && m[1] !== feat) fails.push(`${f}:${lineOf(src, m.index)} imports web feature "${m[1]}" — move it to components/ or lib/`);
    }
  }
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns, `${apiFeats.length} api slices · ${webFeats.length} web slices`);
}

function gateResilience() {
  const fails = [], warns = [];
  const sd = read("docs/system-design.md");
  if (sd === null) return res("FAIL", "docs/system-design.md missing (skill system-design)");
  if (!sd.includes("sequenceDiagram")) fails.push("no sequenceDiagram in system-design.md");
  const reg = table(section(sd, "Resilience register"));
  const idx = ["dependency", "timeout", "retries", "fallback"].map((n) => [n, col(reg.header, n)]);
  if (idx.some(([, i]) => i < 0)) fails.push("## Resilience register table needs Dependency | Timeout | Retries | Fallback columns");
  else if (!reg.rows.length) fails.push("resilience register is empty");
  else for (const r of reg.rows) for (const [n, i] of idx) {
    const v = (r[i] ?? "").trim().toLowerCase();
    if (!v || ["-", "tbd", "todo", "?", "none?"].includes(v)) fails.push(`register row "${r[idx[0][1]]}": empty ${n}`);
  }
  // code scan: network clients without a timeout
  const rules = [[/httpx\.(?:Async)?Client\(/g, () => true], [/\b(?:Async)?OpenAI\(/g, () => true],
    [/\brequests\.(?:get|post|put|patch|delete|request)\(/g, () => true], [/\b(?:Async)?QdrantClient\(/g, (args) => /url\s*=|host\s*=/.test(args)]];
  for (const f of walk("apps/api/app", [".py"])) {
    const src = read(f);
    for (const [re, applies] of rules) {
      for (const m of src.matchAll(re)) {
        let depth = 0, j = m.index + m[0].length - 1;
        for (; j < src.length && j < m.index + 1500; j++) { if (src[j] === "(") depth++; else if (src[j] === ")" && --depth === 0) break; }
        const args = src.slice(m.index + m[0].length, j);
        if (applies(args) && !/timeout/.test(args)) fails.push(`${f}:${src.slice(0, m.index).split("\n").length} ${m[0]}…) without timeout`);
      }
    }
  }
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns, `${reg.rows.length} register rows`);
}

function gateBaseline() {
  const fails = [], warns = [];
  const ad = read("docs/ai-design.md");
  if (ad === null) fails.push("docs/ai-design.md missing");
  else for (const h of ["Model choice", "Pipeline", "Prompts", "Structured outputs", "Baseline"]) if (section(ad, h) === null) fails.push(`ai-design.md: missing ## ${h}`);
  const b = readJson("apps/api/evals/results/baseline.json");
  if (!b) fails.push("apps/api/evals/results/baseline.json missing — run npm run eval:baseline before tuning");
  else {
    for (const k of ["commit", "prompt_versions"]) if (!(k in b)) fails.push(`baseline.json missing "${k}"`);
    if (!("metrics" in b) && !("pass_rate" in b)) fails.push("baseline.json has no metrics");
    if (b.commit && !gitOk(["merge-base", "--is-ancestor", b.commit, "HEAD"])) fails.push(`baseline commit ${b.commit} is not an ancestor of HEAD`);
  }
  if (!walk("apps/api/app", [".md"]).some((f) => /[\\/]prompts[\\/]/.test(f))) warns.push("no prompt files in apps/api/app/features/*/prompts/");
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns);
}

function gateRetrieval() {
  const r = runCmd(CFG.commands.retrieval, "retrieval");
  const out = readJson("apps/api/evals/results/retrieval.json");
  if (!out) return res("FAIL", `retrieval command exit ${r.code}; evals/results/retrieval.json missing`);
  const d = `recall@${out.k}=${out.recall_at_k} mrr=${out.mrr} n=${out.n_queries}`;
  if (r.code !== 0) return res("FAIL", `command exit ${r.code}`, d);
  if (out.n_queries < T.retrieval_min_queries) return res("FAIL", `only ${out.n_queries} golden queries (min ${T.retrieval_min_queries})`, d);
  return res(out.recall_at_k >= T.recall_at_k ? "PASS" : "FAIL", d, `threshold ${T.recall_at_k}`);
}

function cmdGate(id, extra) {
  return () => {
    const r = runCmd(CFG.commands[id], id);
    const more = extra ? extra() : [];
    if (r.timedOut) return res("FAIL", `timed out`, more);
    return res(r.code === 0 && !more.length ? "PASS" : "FAIL", r.code === 0 ? "" : `exit ${r.code}`, more);
  };
}

function gateEval() {
  const r = runCmd(CFG.commands.eval, "eval");
  if (r.code === 3) return res("FAIL", "held-out cases changed after lock");
  const o = readJson("apps/api/evals/results/latest-heldout.json");
  if (!o) return res("FAIL", `eval exit ${r.code}; results/latest-heldout.json missing`);
  const fails = [], warns = [];
  const d = `held-out pass_rate=${o.pass_rate} n=${o.n} generator=${o.generator_model || "?"} judge=${o.judge_model || "-"} cost=$${o.cost_usd}`;
  if (o.n < T.eval_min_heldout) fails.push(`only ${o.n} held-out cases (min ${T.eval_min_heldout})`);
  if (o.skipped) fails.push(`${o.skipped} cases skipped (call budget)`);
  if (o.pass_rate < T.eval_threshold) fails.push(`pass_rate ${o.pass_rate} < ${T.eval_threshold}`);
  const cfg = readJson("apps/api/evals/config.json");
  if (!cfg?.heldout_sha256) warns.push("held-out split not locked (python -m evals.run --lock)");
  const hist = (read("apps/api/evals/history.jsonl") ?? "").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((h) => h && h.split === "heldout" && h.ts !== o.ts);
  const best = Math.max(-1, ...hist.map((h) => h.pass_rate));
  if (best >= 0 && best - o.pass_rate > T.eval_max_regression) fails.push(`regression: best previous ${best} → now ${o.pass_rate}`);
  const gf = family(o.generator_model), jf = family(o.judge_model);
  if (!jf) warns.push("no judge model recorded (deterministic checks only)");
  else if (gf && gf === jf) warns.push(`judge family (${jf}) = generator family — use a different provider`);
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", d, fails, warns);
}

function gateLoad() {
  if (!hasTool("k6", ["version"])) return res("BLOCKED", "k6 not installed — winget install k6 --source winget");
  return cmdGate("load")();
}

function gateRedteam() {
  const fails = [], warns = [];
  const tm = read("docs/threat-model.md");
  if (tm === null) fails.push("docs/threat-model.md missing");
  else {
    const missing = Array.from({ length: 10 }, (_, i) => `LLM${String(i + 1).padStart(2, "0")}`).filter((id) => !tm.includes(id));
    if (missing.length) fails.push(`threat model does not map ${missing.join(", ")}`);
  }
  const r = runCmd(CFG.commands.redteam, "redteam");
  const o = readJson("apps/api/evals/results/redteam.json");
  if (!o) fails.push(`redteam exit ${r.code}; results/redteam.json missing`);
  else {
    if (o.n < T.redteam_min_attacks) fails.push(`only ${o.n} attacks (min ${T.redteam_min_attacks})`);
    if ((o.high_failures ?? []).length) fails.push(`high-severity attacks not blocked: ${o.high_failures.join(", ")}`);
    if (o.pass_rate < T.redteam_min_pass) fails.push(`pass_rate ${o.pass_rate} < ${T.redteam_min_pass}`);
  }
  if (gitOut(["ls-files", ".env"], ROOT)) fails.push(".env is tracked by git — remove it and rotate the secrets");
  let leakStatus = "";
  if (!hasTool("gitleaks", ["version"])) {
    (CFG.gitleaks_required ? fails : warns).push("gitleaks not installed — install it (GitHub releases, winget or scoop) for the secrets scan");
    leakStatus = "BLOCKED";
  } else {
    const sh = { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" };
    let g = spawnSync("gitleaks", ["git", "--redact", "--no-banner", "."], sh);
    if (g.status !== 0 && g.status !== 1) g = spawnSync("gitleaks", ["detect", "--redact", "--no-banner", "--source", "."], sh); // gitleaks < 8.19
    if (g.status === 1) fails.push("gitleaks found secrets in git history (redacted above) — rotate them");
    else if (g.status !== 0) fails.push(`gitleaks could not run (exit ${g.status})`);
  }
  const d = o ? `attacks ${o.n}, pass_rate ${o.pass_rate}` : "";
  const status = fails.length ? (leakStatus === "BLOCKED" && fails.length === 1 ? "BLOCKED" : "FAIL") : warns.length ? "WARN" : "PASS";
  return res(status, d, fails, warns);
}

function mainRoot() {
  const first = gitOut(["worktree", "list", "--porcelain"]).split(/\r?\n/).find((l) => l.startsWith("worktree "));
  return first ? path.resolve(first.slice(9)) : ROOT;
}

function gateFreshClone() {
  const warns = [];
  if (gitOut(["status", "--porcelain"], ROOT)) warns.push("uncommitted changes are not part of this check — commit first");
  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"], ROOT), sha = gitOut(["rev-parse", "HEAD"], ROOT);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-clone-"));
  const dest = path.join(tmp, "repo");
  try {
    if (!gitOk(["clone", "--quiet", ROOT, dest], tmp)) return res("FAIL", "git clone failed");
    gitOk(["checkout", "--quiet", sha], dest);
    for (const rel of [".env", path.join("apps", "web", ".env.local")]) {
      const src = path.join(mainRoot(), rel);
      if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true }); fs.copyFileSync(src, path.join(dest, rel)); }
    }
    for (const [cmd, id] of [[CFG.commands.bootstrap, "fresh-clone"], [CFG.commands.ci, "fresh-clone"]]) {
      const r = runCmd(cmd, id, dest);
      if (r.code !== 0) return res("FAIL", `fresh clone of ${branch}@${sha.slice(0, 7)}: '${cmd}' exit ${r.code}`, warns);
    }
    return res(warns.length ? "WARN" : "PASS", `fresh clone of ${branch}@${sha.slice(0, 7)}: bootstrap + ci green`, warns);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch { console.log(`  (could not delete ${tmp}; delete it later)`); }
  }
}

function gateDeploy() {
  const d = readJson(".orca-team/deploy.json");
  if (!d?.api_url) return res("BLOCKED", "no .orca-team/deploy.json — not deployed yet (needs the human's approval)");
  if (![d.api_url, d.web_url].filter(Boolean).every((u) => /^https:\/\//.test(u))) return res("FAIL", "deploy URLs must be https");
  const cmd = `node scripts/smoke.mjs --api ${d.api_url}${d.web_url ? ` --web ${d.web_url}` : ""}`;
  const r = runCmd(cmd, "deploy");
  return res(r.code === 0 ? "PASS" : "FAIL", `${d.api_url} · ${d.web_url ?? "(no web url)"}`, r.code ? `smoke exit ${r.code}` : "");
}

function gateTracesDoc() {
  const t = read("docs/llmops.md");
  if (t === null) return ["docs/llmops.md missing"];
  return ["SLOs", "Budget", "Fallback chain", "Runbook"].filter((h) => section(t, h) === null).map((h) => `llmops.md: missing ## ${h}`);
}

function gateDryrun() {
  const fails = [], warns = [];
  const dr = read("docs/dry-run.md");
  if (dr === null) fails.push("docs/dry-run.md missing (outsider dry run)");
  else {
    const total = Number((dr.match(/Total:\s*(\d+(?:\.\d+)?)\s*\/\s*100/i) || [])[1] ?? NaN);
    if (Number.isNaN(total)) fails.push("no 'Total: NN/100' line");
    else if (total < T.dry_run_min) fails.push(`dry-run score ${total} < ${T.dry_run_min}`);
    if (!/Blocking issues:\s*none/i.test(dr)) fails.push("'Blocking issues: none' not found");
    const a = family((dr.match(/Author:\s*([^·\n]+)/i) || [])[1]), t = family((dr.match(/Tester:\s*([^·\n]+)/i) || [])[1]);
    if (!a || !t) fails.push("dry run needs 'Author:' and 'Tester:'");
    else if (a === t) fails.push(`tester family (${t}) must differ from author family (${a})`);
    const m = dr.match(/Demo time:\s*(\d+):(\d{2})/i);
    if (!m) warns.push("no 'Demo time: m:ss' line");
    else if (Number(m[1]) * 60 + Number(m[2]) > 180) fails.push(`demo takes ${m[1]}:${m[2]} (> 3:00)`);
  }
  const readme = read("README.md");
  if (readme === null) fails.push("README.md missing");
  else for (const h of ["Run it", "Architecture", "Testing"]) if (!new RegExp(`^##\\s+.*${h}`, "im").test(readme)) fails.push(`README: missing ## ${h}`);
  const demo = read("docs/demo.md");
  if (demo === null || !/\|\s*Time\s*\|/i.test(demo)) fails.push("docs/demo.md with a timing table missing");
  return res(fails.length ? "FAIL" : warns.length ? "WARN" : "PASS", fails, warns);
}

function gateReviews() {
  const dir = path.join(ROOT, ".orca-team", "reviews");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const latest = (kind) => files.map((f) => [f, Number((f.match(new RegExp(`^r(\\d+)-${kind}\\.md$`)) || [])[1])]).filter(([, n]) => n).sort((a, b) => b[1] - a[1])[0]?.[0];
  const fails = [];
  const out = {};
  for (const kind of ["code", "security"]) {
    const f = latest(kind);
    if (!f) { fails.push(`no ${kind} review (.orca-team/reviews/r<N>-${kind}.md)`); continue; }
    const t = fs.readFileSync(path.join(dir, f), "utf8");
    out[kind] = { f, verdict: parseVerdict(t), reviewer: (t.match(/reviewer:\s*([^\n]+)/i) || [])[1] ?? "" };
    if (out[kind].verdict !== "SHIP") fails.push(`${f}: verdict ${out[kind].verdict || "?"} (need SHIP)`);
  }
  if (out.code && out.security) {
    const a = family(out.code.reviewer), b = family(out.security.reviewer);
    if (!a || !b) fails.push("review reports need 'reviewer: <agent/model>' in the title line");
    else if (a === b) fails.push(`code and security reviewers are both ${a} — need two model families`);
  }
  return res(fails.length ? "FAIL" : "PASS", out.code ? `${out.code.f} ${out.code.verdict} · ${out.security?.f ?? "-"} ${out.security?.verdict ?? ""}` : "", fails);
}

const GATES = [
  { id: "prd", hat: "frame", roles: "1", name: "Product owner / requirements", skill: "product-requirements", seat: "LEAD", run: gatePrd },
  { id: "ux", hat: "frame", roles: "2", name: "UX designer (hallway test)", skill: "ux-flow-design", seat: "UI", run: gateUx },
  { id: "adr", hat: "design", roles: "3", name: "Solution architect (C4 + ADRs)", skill: "solution-architecture", seat: "LEAD", run: gateAdr },
  { id: "contracts", hat: "design", roles: "3", name: "Contracts locked (API, DB, eval set)", skill: "solution-architecture", seat: "LEAD", run: gateContracts },
  { id: "slices", hat: "build", roles: "3,8", name: "Vertical-slice boundaries (ADR-0001)", skill: "solution-architecture", seat: "LEAD", run: gateSlices },
  { id: "resilience", hat: "design", roles: "4", name: "System designer (register + timeouts)", skill: "system-design", seat: "LEAD", run: gateResilience },
  { id: "baseline", hat: "design", roles: "5", name: "AI engineer (baseline before tuning)", skill: "ai-engineering", seat: "CORE", run: gateBaseline },
  { id: "retrieval", hat: "design", roles: "6", name: "Data engineer (Recall@k)", skill: "data-engineering", seat: "DATA", run: gateRetrieval },
  { id: "migrations", hat: "design", roles: "7", name: "Database engineer (up/down/up)", skill: "database-engineering", seat: "DATA", run: cmdGate("migrations") },
  { id: "ci", hat: "build", roles: "8,12", name: "Merge gate (lint, types, tests, smoke)", skill: "tech-lead-integration", seat: "LEAD/QA", run: cmdGate("ci") },
  { id: "contract", hat: "build", roles: "9", name: "Backend (Schemathesis)", skill: "backend-engineering", seat: "CORE", run: cmdGate("contract") },
  { id: "e2e", hat: "build", roles: "10", name: "Frontend (Playwright + a11y)", skill: "frontend-engineering", seat: "UI", run: cmdGate("e2e") },
  { id: "eval", hat: "prove", roles: "11", name: "Eval engineer (held-out)", skill: "eval-engineering", seat: "QA", run: gateEval },
  { id: "load", hat: "prove", roles: "12", name: "SQA load (k6 thresholds)", skill: "sqa-testing", seat: "QA", run: gateLoad },
  { id: "redteam", hat: "prove", roles: "13", name: "AI red team + secrets", skill: "ai-red-team", seat: "REVIEWER-SEC", run: gateRedteam },
  { id: "fresh-clone", hat: "ship", roles: "14", name: "One-command run from a fresh clone", skill: "vercel-deploy", seat: "QA", run: gateFreshClone },
  { id: "deploy", hat: "ship", roles: "14", name: "Live URLs smoke (Vercel)", skill: "vercel-deploy", seat: "LEAD", run: gateDeploy },
  { id: "traces", hat: "ship", roles: "15", name: "LLMOps (every call traced)", skill: "llmops-observability", seat: "CORE", run: cmdGate("traces", gateTracesDoc) },
  { id: "dryrun", hat: "ship", roles: "16", name: "Demo & docs (outsider score)", skill: "demo-docs", seat: "QA", run: gateDryrun },
];
const HATS = ["frame", "design", "build", "prove", "ship"];

function runGates(list, opts) {
  const results = [];
  for (const g of list) {
    console.log(`\n=== gate ${g.id} — role ${g.roles} ${g.name} (${g.hat}) ===`);
    let r;
    if (CFG.skip[g.id]) r = res("SKIP", `not applicable: ${CFG.skip[g.id]}`);
    else { try { r = g.run(opts); } catch (e) { r = res("FAIL", `gate crashed: ${e.message}`); } }
    console.log(`→ ${r.status}${r.detail.length ? "\n  - " + r.detail.join("\n  - ") : ""}`);
    results.push({ ...g, ...r });
  }
  return results;
}

function writeReport(results, title) {
  const sha = gitOut(["rev-parse", "--short", "HEAD"], ROOT), branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"], ROOT);
  const icon = { PASS: "✅", WARN: "⚠️", SKIP: "➖", FAIL: "❌", BLOCKED: "⛔" };
  const lines = [`# ${title}`, ``, `_${new Date().toISOString()} · ${branch}@${sha}_`, ``, "| Hat | Role | Gate | Status | Owner | Skill | Detail |", "|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.hat} | ${r.roles} | ${r.id} | ${icon[r.status]} ${r.status} | ${r.seat} | ${r.skill} | ${r.detail.join("; ").replace(/\|/g, "/").slice(0, 400)} |`)];
  fs.writeFileSync(path.join(ROOT, ".orca-team", "GATES.md"), lines.join("\n") + "\n", "utf8");
}

function summary(results) {
  console.log("\n================ SUMMARY ================");
  for (const r of results) console.log(`${r.status.padEnd(8)} ${r.id.padEnd(12)} role ${r.roles.padEnd(5)} ${r.name}`);
  const bad = results.filter((r) => r.status === "FAIL" || r.status === "BLOCKED");
  console.log(bad.length ? `\n${bad.length} gate(s) not passing: ${bad.map((r) => r.id).join(", ")}` : "\nAll selected gates pass.");
  return bad.length ? 1 : 0;
}

function merge(branch) {
  if (!branch) { console.log("usage: gates.mjs merge <branch>"); return 1; }
  if (gitOut(["status", "--porcelain", "--untracked-files=no"], ROOT)) { console.log("FAIL: working tree has uncommitted changes — commit or stash first"); return 1; }
  const reviewFile = path.join(".orca-team", "reviews", `merge-${branch.replace(/[\\/]/g, "-")}.md`);
  const review = read(reviewFile);
  if (review === null) { console.log(`FAIL: write the non-author review first: ${reviewFile} ending with 'Verdict: MERGE'`); return 1; }
  if (parseVerdict(review) !== "MERGE") { console.log(`FAIL: ${reviewFile} verdict is ${parseVerdict(review) || "?"} (need MERGE)`); return 1; }
  if (!gitOk(["rev-parse", "--verify", "--quiet", branch])) { console.log(`FAIL: branch ${branch} not found`); return 1; }
  if (gitOk(["merge-base", "--is-ancestor", branch, "HEAD"])) { console.log(`PASS: ${branch} is already merged`); return 0; }
  const m = spawnSync("git", ["merge", "--no-ff", "--no-commit", branch], { cwd: ROOT, stdio: "inherit" });
  if (m.status !== 0) {
    const conflicts = gitOut(["diff", "--name-only", "--diff-filter=U"], ROOT);
    spawnSync("git", ["merge", "--abort"], { cwd: ROOT, stdio: "ignore" });
    console.log(`FAIL: merge conflicts (aborted). Files:\n${conflicts}\nResolve toward the contract: git merge --no-ff ${branch}, fix, npm run ci, commit.`);
    return 1;
  }
  if (!CFG.skip.slices) {
    const sl = gateSlices();
    if (sl.status === "FAIL") {
      spawnSync("git", ["merge", "--abort"], { cwd: ROOT, stdio: "inherit" });
      console.log(`FAIL: slice boundaries broken with ${branch} merged — merge aborted:\n  - ${sl.detail.join("\n  - ")}`);
      return 1;
    }
  }
  const r = runCmd(CFG.commands.ci, "ci");
  if (r.code !== 0) {
    spawnSync("git", ["merge", "--abort"], { cwd: ROOT, stdio: "inherit" });
    console.log(`FAIL: npm run ci is red with ${branch} merged — merge aborted. Find the root cause (systematic-debugging).`);
    return 1;
  }
  const c = spawnSync("git", ["commit", "--no-edit", "-m", `merge: ${branch}`], { cwd: ROOT, stdio: "inherit" });
  console.log(c.status === 0 ? `PASS: merged ${branch} (ci green, non-author review MERGE)` : "FAIL: commit failed");
  return c.status === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const pos = args.filter((a) => a !== "--strict");
  const [cmd, ...rest] = pos;
  if (!cmd || cmd === "list" || cmd === "help") {
    console.log("Gates (node .orca-team/tools/gates.mjs <id>|hat <hat>|all|merge <branch>|promote):\n");
    for (const g of GATES) console.log(`${g.id.padEnd(12)} ${g.hat.padEnd(7)} role ${g.roles.padEnd(5)} ${g.seat.padEnd(13)} ${g.skill.padEnd(22)} ${g.name}${CFG.commands[g.id] ? `  [${CFG.commands[g.id]}]` : ""}`);
    return 0;
  }
  if (cmd === "merge") return merge(rest[0]);
  if (cmd === "hat") {
    if (!HATS.includes(rest[0])) { console.log(`usage: gates.mjs hat <${HATS.join("|")}>`); return 1; }
    return summary(runGates(GATES.filter((g) => g.hat === rest[0]), { strict }));
  }
  if (cmd === "all" || cmd === "promote") {
    const promote = cmd === "promote";
    const results = runGates(GATES, { strict: strict || promote });
    if (promote) {
      console.log("\n=== gate reviews — latest code + security verdicts ===");
      const r = gateReviews();
      console.log(`→ ${r.status}${r.detail.length ? "\n  - " + r.detail.join("\n  - ") : ""}`);
      results.push({ id: "reviews", hat: "ship", roles: "8", name: "Cross-family review verdicts", skill: "code-review + security-review", seat: "REVIEWERS", ...r });
    }
    writeReport(results, promote ? "Promotion gates" : "Gates");
    const code = summary(results);
    console.log("Report: .orca-team/GATES.md");
    if (promote && code === 0) {
      const lead = gitOut(["rev-parse", "--abbrev-ref", "HEAD"], ROOT);
      console.log(`\nREADY FOR MAIN. Ask the human to approve, then:\n  git checkout main && git merge --no-ff ${lead} && git tag v1.0`);
    }
    return code;
  }
  const unknown = pos.filter((id) => !GATES.some((g) => g.id === id));
  if (unknown.length) { console.log(`unknown gate(s): ${unknown.join(", ")} — run: node .orca-team/tools/gates.mjs list`); return 1; }
  return summary(runGates(GATES.filter((g) => pos.includes(g.id)), { strict }));
}

process.exit(main());
