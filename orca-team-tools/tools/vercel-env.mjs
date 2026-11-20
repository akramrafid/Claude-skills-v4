#!/usr/bin/env node
// vercel-env — push environment variables from the main .env to a linked Vercel project WITHOUT printing values.
//
//   node .orca-team/tools/vercel-env.mjs push --cwd apps/api --env production \
//        [--keys A,B]              upload .env values under the same names
//        [--map NAME=ENVKEY,...]   upload the value of ENVKEY (from .env) as NAME   (e.g. DATABASE_URL=PROD_DATABASE_URL)
//        [--set NAME=value,...]    upload literal non-secret values                  (e.g. APP_ENV=production)
//        [--dry-run]
//   node .orca-team/tools/vercel-env.mjs ls --cwd apps/api --env production
//
// Needs: `npm i -g vercel`, the human ran `vercel login`, and `vercel link` was run in --cwd.
// Uses `vercel env add NAME <env> --force` with the value on stdin (falls back to rm + add on older CLIs).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d = "") => { const i = args.indexOf(k); return i > 0 ? args[i + 1] ?? d : d; };
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const isWin = process.platform === "win32";
const ENVS = new Set(["production", "preview", "development"]);
const NAME = /^[A-Z][A-Z0-9_]*$/;

function mainEnvFile() {
  const first = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" }).split(/\r?\n/).find((l) => l.startsWith("worktree "));
  return path.join(path.resolve(first.slice(9)), ".env");
}
function parseEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (/^["']/.test(v)) { const q = v[0]; const e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); }
    else { const h = v.search(/(^|\s)#/); if (h >= 0) v = v.slice(0, h); }
    out.set(m[1], v.trim());
  }
  return out;
}
const vercel = (vargs, cwd, input) => spawnSync(isWin ? "vercel.cmd" : "vercel", vargs, { cwd, input, encoding: "utf8", shell: isWin });

function main() {
  const cwd = path.resolve(opt("--cwd", "."));
  const target = opt("--env", "production");
  if (!ENVS.has(target)) { console.log(`--env must be one of ${[...ENVS].join(", ")}`); return 1; }
  if (cmd === "ls") { const r = vercel(["env", "ls", target], cwd); process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); return r.status ?? 1; }
  if (cmd !== "push") { console.log("usage: vercel-env.mjs push|ls --cwd <dir> --env production [--keys] [--map] [--set] [--dry-run]"); return 1; }
  if (!fs.existsSync(path.join(cwd, ".vercel", "project.json"))) { console.log(`${cwd} is not linked — run: vercel link --yes --project <name> (in that folder)`); return 1; }

  const envFile = mainEnvFile();
  const env = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : new Map();
  const plan = [];          // [NAME, value, source]
  const problems = [];
  for (const k of list(opt("--keys"))) plan.push([k, env.get(k), `.env ${k}`]);
  for (const pair of list(opt("--map"))) { const [n, src] = pair.split("="); plan.push([n, env.get(src), `.env ${src}`]); }
  for (const pair of list(opt("--set"))) { const i = pair.indexOf("="); plan.push([pair.slice(0, i), pair.slice(i + 1), "literal"]); }
  for (const [n, v, src] of plan) {
    if (!NAME.test(n ?? "")) problems.push(`invalid variable name: ${n}`);
    else if (!v) problems.push(`${n}: no value (${src} is missing or empty)`);
  }
  if (!plan.length) problems.push("nothing to push — use --keys, --map or --set");
  if (problems.length) { console.log("Nothing pushed:\n  " + problems.join("\n  ")); return 1; }

  for (const [n, v, src] of plan) {
    if (args.includes("--dry-run")) { console.log(`would push ${n} (${target}) from ${src}`); continue; }
    let r = vercel(["env", "add", n, target, "--force"], cwd, v);
    if (r.status !== 0 && /unknown|unexpected/i.test(r.stderr ?? "")) {           // older CLI without --force
      vercel(["env", "rm", n, target, "--yes"], cwd);
      r = vercel(["env", "add", n, target], cwd, v);
    }
    console.log(r.status === 0 ? `pushed ${n} (${target}) from ${src}` : `FAILED ${n} (${target}) — vercel exit ${r.status}: ${(r.stderr ?? "").replace(v, "***").trim().slice(-300)}`);
    if (r.status !== 0) return 1;
  }
  console.log("Done. Env changes apply to the NEXT deployment: run `vercel deploy --prod --yes` in that folder.");
  return 0;
}
process.exit(main());
