# Fork Notes

This is a personal fork of [usememos/memos](https://github.com/usememos/memos), deployed to Vercel.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Pristine mirror of `upstream/main`. Never commit to it directly. |
| `deploy` | Default branch. `main` plus fork-only changes; Vercel deploys from here. |

## Remotes

| Remote | URL | Use |
| --- | --- | --- |
| `origin` | `git@github.com:jasonsims/memos.git` | The fork. Push here. |
| `upstream` | `https://github.com/usememos/memos.git` | Fetch only; push is disabled. |

To recreate `upstream` in a fresh clone:

```bash
git remote add upstream https://github.com/usememos/memos.git
git remote set-url --push upstream DISABLE
```

## Syncing With Upstream

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch deploy && git merge main && git push origin deploy
```

`main` must always fast-forward. If `--ff-only` fails, a commit landed on `main` by mistake; move it to `deploy`.

Keep the fork's changes in fork-only files where possible so upstream merges stay conflict-free.

## Fork-Only Files

| File | Purpose |
| --- | --- |
| `FORK.md` | This file. |
| `.claude/rules/fork.md` | Fork-specific Claude Code instructions (see below). |
| `Dockerfile.vercel` | Vercel Container Runtime build: frontend, Go binary, Alpine runtime. |
| `Dockerfile.vercel.dockerignore` | Build context for `Dockerfile.vercel`; upstream's `.dockerignore` excludes `web/`. |
| `.vercelignore` | Keeps `node_modules` and build output out of Vercel CLI uploads. |
| `web/src/lib/pendo.ts` | Pendo (Novus) analytics: anonymous boot with URL privacy transforms, sign-in identify, sign-out reset, and track events (`trackPendoEvent`, the `PendoTrackEvent` name list, property helpers). |
| `web/src/types/pendo.d.ts` | Types for the `window.pendo` agent API used by `web/src/lib/pendo.ts`. |

## Upstream File Changes

Upstream files the fork had to change. Keep these hunks minimal and re-apply them if an upstream merge conflicts.

| File | Change |
| --- | --- |
| `web/index.html` | Pendo install snippet in `<head>`. |
| `web/src/main.tsx` | Calls `initializePendo()` once before the first render. |
| `web/src/contexts/AuthContext.tsx` | Calls `identifyPendoVisitor()` when `initialize()` signs a user in and `clearPendoSession()` in `logout()`. |
| `web/src/lib/error.ts` | `handleError` reports usage limits through `trackUsageLimitReached`; `getErrorTrackProperties` gives failure events their error fields. |
| `web/src/components/MemoEditor/services/errorService.ts` | `getErrorMessage` takes an optional operation, to report usage limits for messages shown without `handleError`. |

Track events: every upstream file that calls `trackPendoEvent` carries a fork hunk; list them with
`git grep -l trackPendoEvent -- web/src`. Pendo matches events by their exact name, so never rename one (see
`PendoTrackEvent`). A few upstream signatures were widened only to give events their properties: `useMemoSave`
(`cacheKey`, `editorRef`), `memoService.save` (returns `updateMask`), `uploadService.uploadFile` (upload path),
`useAttachmentTranscription` (AI setting), `exportMemos` (returns size and type), `useReactionActions` (`entryPoint`),
`PasswordSignInForm` (`entry`), `CreateSpaceDialog` (`entryPoint`), `useAcceptSpaceInvitation` and
`useDeclineSpaceInvitation` (source), and `useUpdateUserGeneralSetting` (change context). `classifyMemoListError`,
`categorizeFile` and `isChunkLoadError` are exported for the same reason.

## Agent Instructions

Upstream keeps its agent instructions in `AGENTS.md`. Claude Code reads `AGENTS.md` only when there is no `CLAUDE.md`,
`.claude/CLAUDE.md`, or `CLAUDE.local.md`, so adding any of those would silently drop upstream's instructions.

Fork instructions live in `.claude/rules/fork.md` instead. Claude Code loads every `.claude/rules/*.md` file alongside
`AGENTS.md` (or alongside a `CLAUDE.md`, if upstream ever adds one), and upstream is unlikely to add a file with this name.
Add more fork rules as additional files under `.claude/rules/`, prefixed `fork-`.

## Vercel Deployment

- Runtime: Vercel Container Runtime (beta), built from `Dockerfile.vercel`, Hobby plan.
- Database: Neon Postgres from the Vercel Marketplace. The entrypoint uses `MEMOS_DSN`, else `DATABASE_URL_UNPOOLED`, else
  `DATABASE_URL`. SQLite and `MEMOS_DATA` (`/tmp/memos`) are ephemeral on Vercel.
- Required env vars: `PORT=5230` in every environment, `MEMOS_INSTANCE_URL` set to the public URL.
- Attachment storage: set Admin > Storage to Database (or S3). Never Local.

Known limits:

- Request bodies cap at 4.5 MB, so attachments larger than that fail to upload.
- Requests cap at 300s on Hobby, so the SSE live-update stream reconnects periodically. The client resyncs on reconnect.
- The SSE hub is in-memory per instance, so live updates may lag across concurrent instances until the next reconnect.
- Instances scale to zero after 5 idle minutes; the next request pays a cold start.

Test the image locally:

```bash
docker build --platform linux/amd64 -f Dockerfile.vercel -t memos-vercel:test .
docker run --rm -p 5230:5230 -e DATABASE_URL="postgresql://..." memos-vercel:test
```
