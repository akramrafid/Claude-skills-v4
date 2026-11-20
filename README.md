# Claude Skills v4 — AI Engineering Hackathon

22 skills for Claude Code (also read by OpenCode and Antigravity): one for each of the 16 hackathon roles,
plus 6 that run the team and review the code to production grade. Each role skill names its hand-off files
and a runnable "done" check (`node .orca-team/tools/gates.mjs <check>`).

| Hat | Skills |
|---|---|
| Frame | `product-requirements`, `ux-flow-design` |
| Design | `solution-architecture`, `system-design`, `ai-engineering`, `data-engineering`, `database-engineering` |
| Build | `tech-lead-integration`, `backend-engineering`, `frontend-engineering` |
| Prove | `eval-engineering`, `sqa-testing`, `ai-red-team` |
| Ship | `vercel-deploy`, `llmops-observability`, `demo-docs` |
| Review & run | `code-review`, `security-review`, `production-hardening`, `production-standards`, `swarm-lead`, `credentials-gate` |

- **[INSTALL.md](INSTALL.md)** — copy-paste PowerShell steps (project or all projects).
- **[SKILLS-INDEX.md](SKILLS-INDEX.md)** — every role → skill → hand-off → check.
- `skills/` — the skill folders (`SKILL.md` + `references/` code templates).
- `orca-team-tools/` — the check runner (`gates.mjs`), test-server helper, Vercel env tool, env checker.

Quick install into a project:
```powershell
git clone https://github.com/akramrafid/Claude-skills-v4 "$env:TEMP\claude-skills-v4"
Copy-Item "$env:TEMP\claude-skills-v4\skills\*" ".claude\skills\" -Recurse -Force
Copy-Item "$env:TEMP\claude-skills-v4\skills\*" ".agents\skills\" -Recurse -Force
```
Run those from the project folder; see INSTALL.md for the check tools and for removing old v3 skills.
