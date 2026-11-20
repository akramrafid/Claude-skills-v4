#!/usr/bin/env node
// envtool — manage .env safely across Orca worktrees. It NEVER prints secret values.
//
//   node .orca-team/tools/envtool.mjs where           path of the main project .env (the one the human edits)
//   node .orca-team/tools/envtool.mjs init            create/update the main .env from this worktree's .env.example
//                                                     (adds missing variables only; never overwrites values)
//   node .orca-team/tools/envtool.mjs check [--main]  status per variable: OK / MISSING / EMPTY / PLACEHOLDER
//   node .orca-team/tools/envtool.mjs sync            copy the main .env into this worktree
//   node .orca-team/tools/envtool.mjs gen KEY [KEY..] fill EMPTY keys in the main .env with random values
//                                                     (for OPS_TOKEN, CANARY, AUTH_SECRET — not provider keys)
//
// Conventions in .env.example: a variable whose inline comment (or the comment line right above it)
// contains the word "optional" is optional.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER = /^(changeme|change[-_]me|your[-_ ].*|xxx+|todo|tbd|placeholder|replace[-_ ]?me|<.*>|\.\.\.|sk-\.\.\.)$/i;

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function worktreeRoot() {
  return path.resolve(git(["rev-parse", "--show-toplevel"]));
}

function mainRoot() {
  // The main worktree is always listed first by `git worktree list`.
  const first = git(["worktree", "list", "--porcelain"]).split(/\r?\n/).find((l) => l.startsWith("worktree "));
  if (!first) throw new Error("Not inside a git repository.");
  return path.resolve(first.slice("worktree ".length));
}

function parseEnv(text) {
  const entries = [];
  let prevComment = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { prevComment = ""; continue; }
    if (line.startsWith("#")) { prevComment = line; continue; }
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { prevComment = ""; continue; }
    const [, key, rest] = m;
    let value = rest;
    let comment = "";
    if (/^["']/.test(rest)) {
      const q = rest[0];
      const end = rest.indexOf(q, 1);
      value = end > 0 ? rest.slice(1, end) : rest.slice(1);
      comment = end > 0 ? rest.slice(end + 1) : "";
    } else {
      const hash = rest.search(/(^|\s)#/);
      if (hash >= 0) { value = rest.slice(0, hash); comment = rest.slice(hash); }
    }
    entries.push({ key, value: value.trim(), optional: /optional/i.test(comment) || /optional/i.test(prevComment), raw });
    prevComment = "";
  }
  return entries;
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function statusRows(exampleText, envText) {
  const example = parseEnv(exampleText);
  const env = new Map(parseEnv(envText ?? "").map((e) => [e.key, e]));
  const rows = example.map((ex) => {
    const cur = env.get(ex.key);
    let status;
    if (!cur) status = ex.optional ? "optional (absent)" : "MISSING";
    else if (cur.value === "") status = ex.optional ? "optional (empty)" : "EMPTY";
    else if (PLACEHOLDER.test(cur.value)) status = "PLACEHOLDER";
    else status = "OK";
    return { key: ex.key, required: !ex.optional, status };
  });
  const exampleKeys = new Set(example.map((e) => e.key));
  const extras = [...env.keys()].filter((k) => !exampleKeys.has(k));
  return { rows, extras };
}

function printCheck(label, envFile, exampleFile) {
  const exampleText = readIfExists(exampleFile);
  if (exampleText === null) {
    console.log(`No .env.example at ${exampleFile} — LEAD creates it in Phase 2.`);
    return 1;
  }
  const envText = readIfExists(envFile);
  console.log(`${label}: ${envFile}${envText === null ? "  (file does not exist yet)" : ""}`);
  const { rows, extras } = statusRows(exampleText, envText);
  const width = Math.max(8, ...rows.map((r) => r.key.length));
  for (const r of rows) console.log(`  ${r.key.padEnd(width)}  ${r.required ? "required" : "optional"}  ${r.status}`);
  if (extras.length) console.log(`  (in .env but not documented in .env.example: ${extras.join(", ")})`);
  const bad = rows.filter((r) => r.required && r.status !== "OK");
  console.log(bad.length ? `\n${bad.length} required variable(s) not ready: ${bad.map((r) => r.key).join(", ")}` : "\nAll required variables are set.");
  return bad.length ? 1 : 0;
}

function isIgnored(root, rel) {
  try { execFileSync("git", ["check-ignore", "-q", rel], { cwd: root, stdio: "ignore" }); return true; }
  catch { return false; }
}

function main() {
  const [cmd, ...flags] = process.argv.slice(2);
  const here = worktreeRoot();
  const main = mainRoot();
  const mainEnv = path.join(main, ".env");

  switch (cmd) {
    case "where": {
      console.log(mainEnv + (fs.existsSync(mainEnv) ? "" : "  (does not exist yet — run: node .orca-team/tools/envtool.mjs init)"));
      return 0;
    }
    case "init": {
      const exampleFile = path.join(here, ".env.example");
      const exampleText = readIfExists(exampleFile);
      if (exampleText === null) { console.log(`No .env.example in ${here}. Create it first.`); return 1; }
      const existing = readIfExists(mainEnv);
      if (existing === null) {
        fs.writeFileSync(mainEnv, exampleText.endsWith("\n") ? exampleText : exampleText + "\n", "utf8");
        console.log(`Created ${mainEnv} from .env.example.`);
      } else {
        const have = new Set(parseEnv(existing).map((e) => e.key));
        const missing = parseEnv(exampleText).filter((e) => !have.has(e.key));
        if (missing.length) {
          const block = [`\n# --- added by envtool init ${new Date().toISOString()} ---`, ...missing.map((e) => e.raw.trim())].join("\n") + "\n";
          fs.appendFileSync(mainEnv, (existing.endsWith("\n") ? "" : "\n") + block, "utf8");
          console.log(`Added ${missing.length} new variable(s) to ${mainEnv}: ${missing.map((e) => e.key).join(", ")}`);
        } else {
          console.log(`${mainEnv} already lists every variable in .env.example.`);
        }
      }
      if (!isIgnored(main, ".env")) console.log("WARNING: .env is NOT gitignored in the main folder. Add it to .gitignore now.");
      console.log("");
      return printCheck("Main .env", mainEnv, exampleFile);
    }
    case "check": {
      const useMain = flags.includes("--main");
      const envFile = useMain ? mainEnv : path.join(here, ".env");
      return printCheck(useMain ? "Main .env" : "This worktree's .env", envFile, path.join(here, ".env.example"));
    }
    case "sync": {
      const target = path.join(here, ".env");
      if (path.resolve(here) === path.resolve(main)) { console.log("This is the main folder — nothing to sync."); return 0; }
      if (!fs.existsSync(mainEnv)) { console.log(`Main .env not found at ${mainEnv}. Ask LEAD to run envtool init.`); return 1; }
      fs.copyFileSync(mainEnv, target);
      console.log(`Copied the main .env into ${target} (values not shown).`);
      if (!isIgnored(here, ".env")) console.log("WARNING: .env is NOT gitignored in this worktree. Do not commit it.");
      return 0;
    }
    case "gen": {
      const keys = flags.filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k));
      if (!keys.length) { console.log("Usage: envtool gen OPS_TOKEN CANARY ..."); return 1; }
      const text = readIfExists(mainEnv);
      if (text === null) { console.log(`Main .env not found at ${mainEnv}. Run envtool init first.`); return 1; }
      const lines = text.split(/\r?\n/);
      for (const key of keys) {
        const re = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=)\\s*(#.*)?$`);
        const idx = lines.findIndex((l) => re.test(l));
        const value = crypto.randomBytes(24).toString("base64url");
        if (idx >= 0) {
          const m = lines[idx].match(re);
          lines[idx] = `${m[1]}${value}${m[2] ? "   " + m[2] : ""}`;
          console.log(`${key}: generated (value not shown)`);
        } else if (lines.some((l) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(l))) {
          console.log(`${key}: already has a value — left unchanged`);
        } else {
          lines.push(`${key}=${value}`);
          console.log(`${key}: added and generated (value not shown)`);
        }
      }
      fs.writeFileSync(mainEnv, lines.join("\n"), "utf8");
      return 0;
    }
    default:
      console.log("Usage: node .orca-team/tools/envtool.mjs <where|init|check [--main]|sync|gen KEY..>");
      return cmd ? 1 : 0;
  }
}

try {
  process.exit(main());
} catch (e) {
  console.error(`envtool: ${e.message}`);
  process.exit(1);
}
