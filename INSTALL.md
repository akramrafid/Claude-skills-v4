# Install the Claude skills (Windows, PowerShell)

Already extracted **orca-swarm-kit-v4.zip** into your project? Then these skills are already in
`.claude\skills` and `.agents\skills` — this pack is the same 22 skills on their own.

## Option A — into your hackathon project (Claude Code + OpenCode + Antigravity)
Open PowerShell and paste (change the project path in the first line if yours is different).
Using the zip instead of GitHub? Replace the `git clone` line with
`Expand-Archive "$HOME\Downloads\claude-skills-v4.zip" -DestinationPath $src -Force`.
```powershell
$proj = "E:\AI Engineering Hackathon"
$src  = "$env:TEMP\claude-skills-v4"
Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue
git clone https://github.com/akramrafid/Claude-skills-v4 $src
New-Item -ItemType Directory -Force "$proj\.claude\skills", "$proj\.agents\skills", "$proj\.orca-team\tools" | Out-Null
Copy-Item "$src\skills\*" "$proj\.claude\skills\" -Recurse -Force      # Claude Code
Copy-Item "$src\skills\*" "$proj\.agents\skills\" -Recurse -Force      # OpenCode + Antigravity
Copy-Item "$src\orca-team-tools\tools\*" "$proj\.orca-team\tools\" -Force   # the "done check" tools
if (-not (Test-Path "$proj\.orca-team\gates.json")) { Copy-Item "$src\orca-team-tools\gates.json" "$proj\.orca-team\" }
```
Had kit v3 before? Remove its 10 old skills (they were merged into the new ones):
```powershell
$old = "architecture-blueprint","backend-api","llm-engineering","ai-agents","rag-pipeline","data-layer","frontend-app","testing-qa","devops-deploy","demo-readiness"
foreach ($d in ".claude\skills", ".agents\skills") { foreach ($s in $old) { Remove-Item "$proj\$d\$s" -Recurse -Force -ErrorAction SilentlyContinue } }
```
Then commit:
```powershell
cd $proj; git add -A; git commit -m "Claude skills v4"
```

## Option B — for every project on this PC (Claude Code only)
```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item "$src\skills\*" "$HOME\.claude\skills\" -Recurse -Force
```
The "done checks" (`node .orca-team/tools/gates.mjs …`) only exist in projects that have the tools from
Option A or the full kit.

## Check it worked
In Claude Code, type `/` and look for `product-requirements`, `backend-engineering`, `code-review`, …
or ask: "Which skills do you have?". In the project: `node .orca-team/tools/gates.mjs list`.

## Use them
- Whole swarm: paste the problem into `TASK.md`, then `/kickoff` (needs the full kit v4).
- One role by hand, e.g. in Claude Code: `/product-requirements` then "write docs/PRD.md from TASK.md".
- Review + make production grade: `/code-review`, then give the findings to the code's owner with
  `/production-hardening`.
