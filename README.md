# README Generator Copilot

Paste a public GitHub URL. Get a beautiful, badge-ready README with an editable
section editor — LLM-powered, multi-ecosystem (npm / Poetry / PEP-621 / Cargo /
Go), and persisted locally in SQLite.

> MVP export is **Copy to clipboard** + **Download `.md`**. Real GitHub-App
> webhooks, auto-PR on commit, multi-language README, and AI image generation
> are documented as stretch goals.

---

## Features

- **Repo analysis** — given `https://github.com/owner/repo`, the backend
  fetches via the unauthenticated GitHub REST API (60 req/hr per IP):
  - the recursive git tree (top-level files + dir names)
  - a recognized manifest (`package.json`, `pyproject.toml`, `Cargo.toml`,
    `go.mod`) — parsed for name, version, description, scripts, deps count,
    license
  - the **5 smallest source files** (sorted by size asc, ~30KB total cap)
  - the **30 most recent commits**
- **LLM analysis** — a single non-streaming chat completion produces a
  structured JSON analysis: tagline, description, 5–10 feature bullets, tech
  stack, getting-started commands (derived from manifest scripts), commit
  themes (computed deterministically via the commit summarizer), license.
  A defensive JSON parser strips code fences and falls back to a deterministic
  default if the LLM misbehaves or is offline.
- **README template** — a pure-function `renderReadme(analysis, sections, meta?)`
  returns a Markdown string with: title + tagline, badges (shields.io static),
  description, features, tech stack table, getting started, ASCII project
  structure tree, recent-commits table (last 10), contributing, license.
- **Section toggle editor** — the UI lists every section as a card with a
  toggle switch, up/down arrows, an editable label, an editable content
  textarea, and an "AI Regenerate" button. The README preview re-renders live.
  Section state is a small set of pure functions: `toggleSection`,
  `reorderSections`, `editSectionContent`, `editSectionLabel`,
  `replaceSection`.
- **Persistence** — every analyze call upserts a `Repo` row (unique on
  `owner+name`) and creates a new `Generation` row containing `analysisJson`,
  `readmeMarkdown`, and `sectionsJson`. Edits are autosaved (debounced 800 ms)
  via `PATCH /api/generations/[id]`.
- **Per-section regeneration** — `POST /api/generations/[id]/regenerate-section`
  re-runs the LLM for one section, preserving the rest of the README.

## MVP scope vs. stretch goals

| Feature | Status | Notes |
| --- | --- | --- |
| Repo analysis (tree + manifest + files + commits) | **MVP** | Unauthenticated REST API, 60 req/hr. |
| LLM structured analysis | **MVP** | Strict JSON, defensive parsing, fallback analysis on failure. |
| README template + renderer | **MVP** | Pure function, badges, ASCII tree, recent commits table. |
| Section toggle / reorder / edit editor | **MVP** | Live preview, autosaved. |
| Per-section AI regeneration | **MVP** | One-shot LLM call per section. |
| Copy + `.md` download export | **MVP** | No PR creation. |
| Real GitHub App webhooks | **stretch** | Documented below. |
| Auto-PR on commit | **stretch** | Documented below. |
| Multi-language README (EN/Chinese) | **stretch** | Documented below. |
| AI logo + hero image generation | **stretch** | Documented below. |

## Tech stack

| Tool / Library | Role |
| --- | --- |
| Next.js 16 (App Router) | Web framework + API routes |
| TypeScript 5 | Language |
| Tailwind CSS 4 + shadcn/ui (New York) | Styling + components |
| Prisma 6 + SQLite | Local persistence (Repo + Generation) |
| z-ai-web-dev-sdk | LLM provider (chat completions, non-streaming) |
| GitHub REST API v3 | Repo metadata, tree, manifest, source files, commits |
| Zustand | Client-side editor store (sections + analysis + meta) |
| react-markdown | README preview rendering |
| bun test | Unit tests (80+ across 8 suites) |
| eslint-config-next | Lint baseline |

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Browser (src/app/page.tsx)                                  │
│  ┌────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │ Repo list  │  │ README preview │  │ Sections editor    │  │
│  │ (left)     │  │ (center)       │  │ (right)            │  │
│  │            │  │                │  │                    │  │
│  │ - analyze  │  │ react-markdown │  │ toggle / reorder / │  │
│  │ - repos[]  │  │ render of the  │  │ edit / regen      │  │
│  │ - delete   │  │ live markdown  │  │ per-section        │  │
│  └────────────┘  └────────────────┘  └────────────────────┘  │
│         │                ▲                  │                │
│         │                │  Zustand store  │                │
│         │                │  (sections +    │                │
│         │                │   analysis)     │                │
│         │                └──────────────────┘                │
└─────────┼───────────────────────────────────┼────────────────┘
          │ fetch                             │ fetch (debounced)
          ▼                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers                                      │
│  POST /api/repos/analyze        GET    /api/repos            │
│  GET  /api/repos/[id]           DELETE /api/repos/[id]       │
│  GET  /api/generations/[id]      PATCH  /api/generations/[id]│
│  POST /api/generations/[id]/regenerate-section              │
│  GET  /api/stats                                              │
└─────────┬──────────────────────────────────────┬─────────────┘
          │                                      │
          ▼                                      ▼
┌──────────────────────┐         ┌──────────────────────────────┐
│ src/lib              │         │ Prisma + SQLite              │
│ - url-parser         │         │ models: Repo, Generation     │
│ - github-fetcher     │◀────────│ unique: owner+name           │
│ - package-json-parser│         │ cascade: Repo -> Generation  │
│ - commit-summarizer  │         └──────────────────────────────┘
│ - analyzer           │
│ - readme-renderer    │
│ - section-toggle     │
│ - ai (ChatProvider)  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│ External                                                     │
│ - GitHub REST API (https://api.github.com, 60 req/hr)         │
│ - z-ai-web-dev-sdk (chat completions, non-streaming)          │
└──────────────────────────────────────────────────────────────┘
```

## Setup

```bash
# 1. Install dependencies (bun is preferred — npm/yarn also work)
bun install

# 2. Create the SQLite database + Prisma client
bun run db:push      # creates db/custom.db + applies schema
bun run db:generate  # regenerates the @prisma/client when schema changes

# 3. (Optional) set environment variables
cp .env.example .env
# Edit .env to set PKC_DISABLE_LLM=1 if you don't have LLM access

# 4. Run the dev server
bun run dev          # http://localhost:3000

# 5. Run the tests
bun test
```

### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Absolute path to the SQLite file. Must start with `file:`. |
| `PKC_DISABLE_LLM` | no | `0` | Set to `1` to use the deterministic MockProvider (no LLM access). |
| `GITHUB_API_BASE` | no | `https://api.github.com` | Override for GitHub Enterprise. |
| `GITHUB_TOKEN` | no | — | Bumps rate limit from 60 req/hr to 5,000 req/hr. **Not used in MVP** — documented for stretch. |

## Tests

Run the full suite:

```bash
bun test
```

Test suites (81 tests across 8 suites):

| File | Tests | What it covers |
| --- | --- | --- |
| `url-parser.test.ts` | 10 | https / SSH / `.git` suffix / tree/branch / non-GitHub hosts |
| `package-json-parser.test.ts` | 12 | npm / Poetry / PEP-621 / Cargo / go.mod / object-form license / content sniffing |
| `commit-summarizer.test.ts` | 9 | tokenize / top-K / dedupe / first-line-only / exampleSha |
| `section-toggle.test.ts` | 16 | toggle / enable / reorder / move-by-id / edit content+label / replace / find |
| `readme-renderer.test.ts` | 11 | title/tagline / badges / all sections / toggle off / reorder / verbatim edit / ASCII tree / recent commits / degraded inputs |
| `github-fetcher.test.ts` | 5 | happy path / Python repo (no manifest) / 404 / rate limit / 404 on tree |
| `analyzer.test.ts` | 14 | buildPrompt content / happy path / commitThemes / fallback / safeParseAnalysis / buildSectionPrompt |
| `ai.test.ts` | 4 | ChatProvider mock pattern (injection, reply, reset, throwing) |

## API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/repos/analyze` | Body `{ url }`. Fetches tree + manifest + 5 small files + 30 commits. Runs LLM. Persists a new Generation. Returns analysis + initial README + sections + meta. |
| `GET` | `/api/repos` | Lists analyzed repos (most-recently-analyzed first). |
| `GET` | `/api/repos/[id]` | Single repo with all its generations. |
| `DELETE` | `/api/repos/[id]` | Deletes a repo (cascades to its generations). |
| `GET` | `/api/generations/[id]` | Single generation: analysis JSON + readme markdown + sections JSON + repo metadata. |
| `PATCH` | `/api/generations/[id]` | Updates sections (toggle/reorder/edit) + recomputes the README markdown. |
| `POST` | `/api/generations/[id]/regenerate-section` | Body `{ sectionId, hint? }`. Re-runs the LLM for one section, persists, returns the new section. |
| `GET` | `/api/stats` | `{ repos, generations }`. |

## Project structure

```text
.
├── LICENSE
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── components.json
├── eslint.config.mjs
├── .env.example
├── .gitignore
├── prisma/
│   └── schema.prisma                # Repo + Generation models
├── db/
│   └── custom.db                    # SQLite (created by db:push)
├── public/
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                  # 3-column: repo list / preview / sections editor
    │   ├── globals.css
    │   └── api/
    │       ├── stats/route.ts
    │       ├── repos/
    │       │   ├── route.ts
    │       │   └── [id]/route.ts
    │       └── generations/
    │           └── [id]/
    │               ├── route.ts
    │               └── regenerate-section/route.ts
    ├── components/
    │   └── ui/                       # shadcn/ui subset
    ├── hooks/
    │   └── use-toast.ts
    └── lib/
        ├── ai.ts                    # ChatProvider interface + ZaiProvider + MockProvider
        ├── analyzer.ts               # analyzeRepo + regenerateSection + safeParseAnalysis
        ├── commit-summarizer.ts      # tokenizeCommit + summarizeCommits (pure)
        ├── db.ts                     # Prisma client
        ├── github-fetcher.ts         # fetchRepoMeta (resilient, injectable fetcher)
        ├── package-json-parser.ts    # parseManifest (multi-ecosystem)
        ├── readme-renderer.ts        # renderReadme + defaultSections + renderBadges (pure)
        ├── section-toggle.ts         # pure section state transitions
        ├── store.ts                  # Zustand editor store
        ├── types.ts                  # shared domain types
        ├── url-parser.ts             # parseRepoUrl (pure)
        ├── utils.ts                  # cn (clsx + tailwind-merge)
        └── __tests__/
            ├── ai.test.ts
            ├── analyzer.test.ts
            ├── commit-summarizer.test.ts
            ├── github-fetcher.test.ts
            ├── package-json-parser.test.ts
            ├── readme-renderer.test.ts
            ├── section-toggle.test.ts
            └── url-parser.test.ts
```

## Case study — what's interesting

### 1. LLM analysis with a structured, defensive contract

The analyzer sends a single non-streaming chat completion whose system prompt
instructs the model to return strict JSON with five required top-level fields
(tagline, description, features, techStack, gettingStarted). The user-side
prompt embeds the repo's name, manifest info (name/version/description/scripts
/dependency counts), top source files, and recent commits — plus the
**deterministically computed** commit themes (so the LLM can echo them but
cannot invent them).

`safeParseAnalysis()` strips ` ```json ` fences and trailing prose, finds the
first balanced `{...}` block, and `JSON.parse`s it. If anything fails — a
network error, a non-JSON reply, a missing required field — `fallbackAnalysis()`
returns a sensible default derived from the manifest (ecosystem-specific
feature bullets, dependency list as the tech stack, manifest license as the
README license). The README always renders.

### 2. Section toggling as pure-function state transitions

The section editor never mutates state in place. Every operation
(`toggleSection`, `reorderSections`, `editSectionContent`, `editSectionLabel`,
`replaceSection`) returns a **new** array. The Zustand store composes them and
calls `renderReadme()` after each transition, so the preview is always
consistent with the editor. The same pure functions are tested in isolation in
`section-toggle.test.ts` (16 tests) and reused by the API route
`POST /api/generations/[id]/regenerate-section` via `replaceSection`.

### 3. Multi-manifest support without a TOML dependency

`parseManifest()` supports four ecosystems (npm / Poetry / PEP-621 / Cargo /
Go) without pulling in a TOML parser. It sniffs the content (leading `{` →
JSON; `[tool.poetry]` or `[project]` → pyproject; `[package]` + `name =` →
Cargo; `^module\s+\S+` + `^go\s+\d` → go.mod) and uses a tiny TOML-ish line
iterator (`tomlSection`) to extract scalar keys, plus a top-level-comma
splitter for PEP-621 dependency arrays. The result is one normalized
`ManifestInfo` shape that the analyzer and renderer can both consume — the
renderer's "Getting Started" section picks install/run commands based on
`ecosystem` and the manifest's `scripts` map.

### 4. Resilient GitHub fetcher

`fetchRepoMeta()` is designed so that **no single missing piece breaks the
whole analysis**: a 404 on the repo returns an empty meta with
`missingParts: ['repo']`; a 404 on the tree leaves `tree: []` (the renderer
shows a placeholder); a 404 on any source file is skipped; rate-limit
responses set `rateLimited: true` and stop further requests. The fetcher
takes an injectable `fetcher` argument so tests can pass a deterministic mock.

## What I'd do differently (stretch goals)

### Real GitHub App + webhooks

The MVP uses the unauthenticated REST API (60 req/hr per IP). To scale to a
multi-user product:

- Ship a GitHub App (not OAuth) with `contents:read` and `metadata:read`
  permissions. Subscribe to `push` and `create` webhooks.
- On `push` to the default branch, re-run the analyzer and update the
  in-DB Generation. Show a "live, last analyzed at `abc1234`" badge.
- Webhook delivery requires a public URL — use Smee.io for local dev and a
  proper ingress (Cloudflare Tunnel / Vercel) for production.
- Persist the installation ID + repo ID per installed repo so we can fetch
  with the installation token (5,000 req/hr per installation, not per IP).

### Auto-PR on commit

- After regenerating the README, open a PR via
  `POST /repos/{owner}/{repo}/pulls` with a branch named
  `readme-generator/auto-update-<sha>`.
- Use the GitHub "create a commit on a branch" API (with a tree + parents)
  so the commit is signed and the PR is single-commit. Reference the source
  commit SHA in the PR body so reviewers can diff what triggered the update.
- Add a `--dry-run` flag and a `readme-generator:skip` commit-message trailer
  so users can opt out for specific pushes.

### Multi-language README (EN / Chinese)

- Add a `language` field to `Section` and `RepoAnalysis`. After the English
  pass, run a translation prompt per section that preserves markdown
  structure (code blocks, tables, lists, links) — only translates prose and
  headings.
- Render a language switcher in the preview pane. Persist sections per
  language in `sectionsJson` keyed by ISO code (`{ en: [...], zh: [...] }`).
- Emit `<a>` links at the top of the README: `[English](./README.md) |
  [中文](./README.zh.md)` — and write both files in the auto-PR branch.

### Real image generation (logo + hero)

- After the LLM produces the analysis, run a second LLM call that proposes a
  one-line logo prompt and a one-line hero-image prompt from the project
  name + tagline + tech stack.
- Call the z-ai-web-dev-sdk image-generation endpoint to produce a PNG logo
  (256×256) and a hero image (1200×400). Store both as base64 in the
  `Generation` row (or as files in `/public/generated/{repoId}/`).
- Inject `![Logo](./logo.png)` between the tagline and the badges block,
  and `![Hero](./hero.png)` as the first thing inside the Description
  section. Toggle them via the existing section-toggle editor.

## Resume bullet

> Built README Generator Copilot — a Next.js 16 + Prisma app that analyzes a
> public GitHub repo (tree, manifest, top source files, recent commits) via
> the REST API and generates a badge-ready README using an LLM with a
> strict-JSON contract and a defensive fallback. Shipped a multi-ecosystem
> manifest parser (npm / Poetry / PEP-621 / Cargo / go.mod) without a TOML
> dependency, a pure-function section-toggle editor with live preview and
> per-section AI regeneration, and 80+ unit tests across 8 suites.

## License

MIT — see [LICENSE](LICENSE).

## Push to your own GitHub

```bash
gh repo create readme-generator --public --source=. --remote=origin --push
```
