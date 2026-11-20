# CI and repo hygiene (reference for tech-lead-integration)

No Docker, no servers: CI runs the same root scripts the agents run locally.

## 1. Optional GitHub Actions (`.github/workflows/ci.yml`) — only if the repo lives on GitHub
```yaml
name: ci
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    env:
      APP_ENV: test
      LLM_MOCK: "1"
      TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}   # Neon test branch; the human adds the secret
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm install && npm --prefix apps/web install
      - run: cd apps/api && uv sync --frozen
      - run: npm run ci
```
Secrets reach CI only if the human adds them as repository secrets. Without `TEST_DATABASE_URL`, DB
integration tests skip with a clear reason (never silently pass).

## 2. Cross-platform hygiene (the team is on Windows)
`.gitattributes`:
```
* text=auto
*.sh text eol=lf
*.mjs text eol=lf
*.ps1 text eol=crlf
```
- Root `npm run` scripts only; no bash-only syntax (`VAR=x cmd` fails in cmd.exe) → runner flags or `.env`.
- Paths with spaces (e.g. `E:\AI Engineering Hackathon`): Node tools spawn without a shell or quote paths.
- `.gitignore` covers `.env`, `.env.local`, `.data/`, `.vercel/`, `node_modules/`, `.venv/`,
  `apps/api/evals/.cache/`, `playwright-report/`, `test-results/`.

## 3. Release hygiene
Tag the submitted commit (`git tag v1.0`) · `git ls-files .env` prints nothing · `npm run gates` table
committed in `.orca-team/GATES.md` · README "Run it" verified by `gates.mjs fresh-clone`.
