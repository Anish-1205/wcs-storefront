# Release process

## Chosen option: B — branch protection on `main`, owner bypass allowed

Vercel deploys on every push to `main` **without waiting for GitHub
Actions** (official Vercel Git docs) — a failing CI run does not by itself
stop a bad commit reaching production. T1.12 adds a branch protection rule
on `main` requiring a passing status check before a **non-admin** can merge.
The repo owner (admin) can still push directly, so the existing "redeploy =
commit + push to `main`" workflow (see project memory) keeps working
unchanged. The rule exists to stop an *unreviewed contributor* change from
landing with red CI — it does not change how the owner ships.

**Required status check:** `Lint, types, unit tests, build` (the single job
in `.github/workflows/ci.yml`). `e2e.yml` (Playwright) and `codeql.yml`
(CodeQL) keep running on every push/PR as before — they are not required to
merge, because they are slower and this task scope (per the owner) is just
the one check. They can be promoted to required checks later without further
code changes (see "Moving to Option A" below).

Job names are referenced by exact string in the branch protection rule.
**Do not rename the `name:` of that job in `ci.yml`** — doing so silently
breaks the required check (GitHub will show "waiting for status" forever
until the rule is updated to the new name).

## How to push / redeploy (owner)

Nothing changes for the owner. "Redeploy" still means: commit, `git push
origin main`, confirm Vercel reaches `Ready` and CI is green
(`gh run list`) — see project memory `redeploy-command`. Branch protection
with admin bypass does not block this; it only blocks a PR merge by a
non-admin account when the required check hasn't passed.

Opening a PR instead of pushing directly is still fine and still runs the
same CI — just not required for the owner's own pushes.

## Break-glass (if the rule ever blocks the owner unexpectedly)

This should not happen with bypass allowed, but if GitHub ever refuses a
push (e.g. bypass was accidentally turned off, or a ruleset instead of
classic protection was applied without an owner bypass actor):

1. GitHub → repo → **Settings → Rules → Rulesets** (or **Branches** for
   classic protection) → open the `main` rule.
2. Either:
   - Temporarily disable the rule (toggle it off, push/merge, re-enable), or
   - Add your account under "Bypass list" / "Allow specified actors to
     bypass required pull requests" if it was somehow not already there.
3. Re-enable/restore the rule immediately after the push — don't leave it
   disabled.
4. Record the incident (what forced the bypass, and whether the rule
   configuration needs fixing) in a follow-up note so it doesn't recur
   silently.

## Moving to Option A later (PR-and-merge, no bypass)

When ready to require PRs for every change including the owner's own:

1. In the same branch protection rule, uncheck "allow specified actors to
   bypass" (or remove the admin from the bypass list).
2. Decide whether to add `Playwright (storefront + admin)` and/or
   `Analyze (javascript-typescript)` as additional required checks — they
   are already running on every PR, so this is a settings-only change.
3. Update the "How to push / redeploy" section above and the
   `redeploy-command` memory: redeploy becomes push a branch → open PR →
   wait for required checks → merge (Vercel deploys from the merge commit).
4. No code or workflow file changes are needed for this transition; the
   workflows already run on `pull_request` and `push` to `main`.

## Applying the rule (settings only — owner runs these, not Claude)

Either the GitHub UI or the API can create the rule. Both are equivalent;
pick one.

### Dashboard steps

1. Repo → **Settings → Branches** → **Add branch protection rule** (or
   **Settings → Rules → Rulesets** → **New branch ruleset**, GitHub's newer
   UI — either works for a public repo on the Free plan).
2. Branch name pattern: `main`.
3. Enable:
   - Require a pull request before merging (default reviewer count: 0, this
     is a solo project).
   - Require status checks to pass before merging → search for and select
     **`Lint, types, unit tests, build`** only.
   - Require branches to be up to date before merging.
   - Do not allow force pushes.
   - Do not allow deletions.
4. Leave **"Do not allow bypassing the above settings"** unchecked (that is
   what keeps the owner's direct push working) — or, on the classic
   Branches UI, leave "Include administrators" **unchecked**.
5. Save.

### Equivalent `gh api` commands (classic branch protection)

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/Anish-1205/wcs-storefront/branches/main/protection \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Lint, types, unit tests, build' \
  -F enforce_admins=false \
  -F required_pull_request_reviews=null \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Notes:
- `enforce_admins=false` is what gives the owner's account bypass — it is
  the direct equivalent of leaving "Include administrators" unchecked.
- `required_pull_request_reviews=null` means no required-reviewer PR
  gate is added beyond the one status check; set it to an object (e.g.
  `required_approving_review_count=0`) instead of `null` if a required-PR
  shape is preferred over `null` — test in a throwaway repo first, this
  endpoint is picky about which fields accept `null` vs an object.
- Verify with: `gh api repos/Anish-1205/wcs-storefront/branches/main/protection`
  (currently 404 "Branch not protected" — confirmed before writing this doc).

### Vercel Deployment Checks (optional, availability on Hobby UNVERIFIED)

Vercel Project → **Settings → Git → Deployment Checks** → add a check
pointed at the same GitHub Actions job (`Lint, types, unit tests, build`)
on the `main`/production environment, if the option is present on the
Hobby plan. If it is not offered, branch protection above is the only gate
in place — document whichever is true once checked, in this file.

## Manual verification checklist (run after the rule is applied)

- [ ] **Failing PR is blocked:** open a PR from a non-admin-equivalent
      branch with a deliberately failing test/lint, confirm the PR's merge
      button is disabled/red and shows "Lint, types, unit tests, build"
      as failing/pending.
- [ ] **Passing PR merges and deploys:** open a PR with a passing change,
      confirm the required check goes green, merge succeeds, and Vercel
      promotes a new production deployment from the merge commit.
- [ ] **Owner bypass works:** push a trivial commit directly to `main`
      (not via PR) as the owner and confirm it is accepted and Vercel
      deploys normally — i.e. the existing redeploy workflow is unaffected.
- [ ] Record the Vercel Deployment Checks availability finding (works /
      not available on Hobby) here once checked.
