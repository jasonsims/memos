# Fork Rules

This repository is a personal fork of usememos/memos. Read `FORK.md` for branches, remotes, and the Vercel deployment.
These rules add to the upstream `AGENTS.md`; where they conflict, these win.

- Work on `deploy` or a branch cut from it. Never commit to `main`; it must fast-forward to `upstream/main`.
- Never push to `upstream`. Push only to `origin`.
- Prefer fork-only files (`FORK.md`, `Dockerfile.vercel`, `.claude/rules/fork*.md`) over editing upstream files, so
  upstream merges stay conflict-free. When an upstream file must change, keep the diff minimal and note it in `FORK.md`.
- Do not add `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md`: any of them stops Claude Code from reading the
  upstream `AGENTS.md`. Put fork instructions in `.claude/rules/` instead.
- Keep `FORK.md` current when fork-only files, the deployment, or the sync workflow change.
- Production runs on Vercel's Container Runtime with Neon Postgres. Assume an ephemeral filesystem, a 4.5 MB request
  body limit, and a 300s request limit. Verify image changes with a local `docker build -f Dockerfile.vercel`.
