# Dependencies: upgrades, audit, lint (T6.9)

## How upgrades arrive

- **Dependabot** (`.github/dependabot.yml`), weekly: one grouped PR for
  production minor/patch updates, one for development, one for GitHub
  Actions (SHA pins included). Majors are ignored on purpose.
- **Review**: CI (`Lint, types, unit tests, build`), `Database`, `Secret scan`
  and E2E must be green. Read the changelog of anything that touches
  rendering (Next, React), auth (`@supabase/*`), the WhatsApp pipeline or
  Sentry. Check the Vercel preview, then merge.
- **Majors** (Next, React, ESLint, Tailwind, zod, vitest, TypeScript) get
  their own branch: run the vendor codemods, read the migration guide, run the
  full suite including `npm run test:ingest` and the a11y spec, and deploy
  on their own so a rollback is one revert.

## Audit (recorded 2026-10-20)

`npm audit --omit=dev --audit-level=high` is CI's gate: **0
vulnerabilities**. The CI audit step used to fail on every push, because
`tailwindcss-animate` sat in `dependencies` and pulled Tailwind 3 into the
production tree. It is now a devDependency.

Full `npm audit` including dev tooling: 9 (7 high, 2 moderate), all of them
build-time:

| Package chain | Why it is here | Fix |
| --- | --- | --- |
| `tailwindcss@3` → `chokidar`/`fast-glob`/`micromatch` → `braces`; `postcss-nested` → `postcss-selector-parser` | Tailwind 3's file watcher and nesting plugin, used while building CSS | Tailwind 4 (breaking: new config format, plugin changes) |
| `eslint-config-next@15` → `@next/eslint-plugin-next` → `fast-glob` | the lint config | moves with the Next 16 / ESLint 9 upgrade below |

None of these packages runs in production or touches user input; they read
the repo's own files at build time. Fix them with the majors, not with
`npm audit fix --force`.

## Security round (recorded 2026-10-25, commit 300a7b2)

All 17 open Dependabot alerts were closed in one commit; full `npm audit`
(dev included) is **0 vulnerabilities**.

| Package | To | Alert |
| --- | --- | --- |
| `next` / `eslint-config-next` | 15.5.28 (exact pin kept) | critical: RCE in the image optimiser with SVG; high: Server Actions DoS |
| `@sentry/nextjs` | 10.76.2 | critical: middleware bypass via the tunnel route |
| `zod` | 4.6.7 (major) | high: memory exhaustion on oversized constrained collections |
| `vitest`, `vite`, `fast-uri`, lighthouse's `puppeteer-core` | patched | dev/build only |
| `postcss-selector-parser` | 7.x via `overrides` | dev only; Tailwind 3 pins 6.x |

- **Zod 4** needed only: `ZodError.errors` → `.issues`, and `z.record()` now
  takes a key schema. Zod 4 enforces RFC 4122 UUIDs, so test fixtures use
  valid v4 IDs (`…-4…-8…`) — real IDs all come from `gen_random_uuid()` /
  `crypto.randomUUID()`.
- **The `postcss-selector-parser` override** was checked by building
  Tailwind's CSS before and after: byte-identical. Drop it when Tailwind 4
  lands.
- Dependabot PRs #29/#30 were superseded; the non-security remainder is in
  #32 (incl. `@supabase/ssr` 0.6 → 0.12, which needs its own sign-in test) and
  #33.

## Lint: `next lint` is going away

`next lint` prints "deprecated and will be removed in Next.js 16". This repo
uses ESLint 8 with `.eslintrc.json` and `eslint-config-next`.

| Option | For | Against |
| --- | --- | --- |
| **ESLint 9 flat config via the Next codemod** (`npx @next/codemod@latest next-lint-to-eslint-cli .`) | Official path; keeps `eslint-config-next` (React hooks, Next-specific rules, `no-img-element`); existing `eslint-disable` comments keep working | Flat-config migration is a one-off change to config files |
| Biome | One fast binary for lint and format | No Next.js rule set (`@next/next/*`), no React-hooks exhaustive-deps parity; every existing `eslint-disable` comment would be reworked |

**Decision: ESLint flat config, done together with the Next 16 upgrade.**
There is no reason to switch to Biome: the Next-specific rules are the
valuable part. Until then `next lint` works (Next 15.5 only warns).

## Small hygiene done here

- `next.config.mjs` imports `withSentryConfig` from `@sentry/nextjs/config`.
  The old path warned that it stops working in Sentry v11.
