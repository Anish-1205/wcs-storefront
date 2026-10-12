# Secrets, keys and credential-loss recovery (T1.4)

Companion to [backup-scope.md](backup-scope.md) (what is backed up) and
[backup-restore.md](backup-restore.md) (how to restore it). This file is
about the credentials that make those two possible, and what to do when one
of them is lost.

**Status: docs complete, owner steps pending.** The procedures below are
written and the decisions are made; the physical custody work (key copies,
escrow, second repo admin) is the owner's and is listed at the end.

---

## The one rule

**The `age` private key never leaves the owner's control in a form that
something else can read.** Specifically it never:

- goes into a CI secret, environment variable or workflow file — CI only
  ever holds the **public** key (`AGE_PUBLIC_KEY`);
- gets pasted into a chat window, an AI assistant, an issue, a commit
  message or an email;
- sits in a cloud-synced folder (OneDrive, Dropbox, Google Drive) or a git
  repository;
- is read by a command whose output is logged — no `cat`, `type`, `echo`,
  `Get-Content`, no `-v` on a tool that echoes its inputs.

Every tool that needs it takes a **path**: `age -d -i <path>`, and
`scripts/restore-drill.mjs --key <path>`. That is the only supported way to
use it.

Compromising the ops repo therefore lets an attacker write a backup nobody
can read, not read one. Losing the private key makes every existing backup
permanently unrecoverable — which is why there are three copies.

---

## Custody decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Number of private-key copies | **Three** | Two survives one loss; three survives a loss plus an inaccessible location (travel, fire, lockout). |
| Copy 1 | Password-manager vault, as a secure note or file attachment | Always reachable, already backed up, already 2FA-protected. |
| Copy 2 | Offline medium (USB stick or printed) kept at home, not next to the laptop | Survives the vault being locked out or the account being compromised. |
| Copy 3 — **escrow: yes** | A trusted person, or a physical safe / safe-deposit box | Survives the owner's house and accounts both being unavailable. The holder does not need to understand it; they need to be able to hand it back. |
| Second admin on the ops repo — **yes** | A second GitHub account with admin on `Anish-1205/wcs-backup-ops` | Repo access must survive the owner losing their own GitHub account; without it the artifacts are unreachable even with the key. |
| Key file format | `age-keygen` output, unchanged, named with its creation date (`wcs-backup-age-2026-10.key`) | The date is how you tell the current key from a retired one during rotation. |

**Escrow hygiene:** the escrow copy is the key **only**. It is not the
GitHub credentials and not the ops-repo location. A holder who has the key
but no repo access cannot read the backups, and a repo admin who has no key
cannot either. Keep that separation.

**The loose file must go.** `C:\Users\anish\wcs-backup-age.key` is a working
copy on the laptop, not one of the three. Once all three copies are verified
(below), `shred -uz` it and from then on copy it out of the vault for the
duration of a drill and shred it again afterwards.

---

## Quarterly test-decrypt

A copy you have never decrypted with is not a copy. **Once a quarter, test
each stored copy** — not just the convenient one.

The full drill is the better test, because it proves decrypt *and* restore:

```bash
export AGE_BIN="$LOCALAPPDATA/Microsoft/WinGet/Packages/FiloSottile.age_Microsoft.Winget.Source_8wekyb3d8bbwe/age/age.exe"
gh run list -R Anish-1205/wcs-backup-ops --workflow backup.yml --limit 5
node scripts/restore-drill.mjs --run <run-id> --key /path/to/the/copy/under/test
```

When you only want to prove a copy decrypts (no Postgres needed):

```bash
# 1. Fetch any current artifact into an empty directory.
gh run download <run-id> -R Anish-1205/wcs-backup-ops -D ./keytest
# 2. Decrypt with the copy under test. Success is the whole result.
age -d -i /path/to/the/copy/under/test -o ./keytest/bundle.tar ./keytest/pgdump-*/pgdump-*.tar.age
# 3. Prove it is the real bundle, not just bytes.
mkdir ./keytest/bundle && tar -xf ./keytest/bundle.tar -C ./keytest/bundle
cd ./keytest/bundle && sha256sum -c <<<"$(jq -r '.dump.sha256 + "  " + .dump.file' manifest.json)"
# 4. Shred. The decrypted dump is real customer data.
cd - && find ./keytest -type f -exec shred -uz {} \; && rm -rf ./keytest
```

Record the date and which copy was tested in the drill log at the bottom of
[backup-restore.md](backup-restore.md). A copy that fails to decrypt is a
lost copy: replace it from a good one the same day.

The workflow's own `mode=self-test` proves the *toolchain* with an ephemeral
keypair and never touches the production key. It is not a substitute for
this — it would pass even if all three copies were corrupt.

---

## Yearly key rotation

Rotate every year, and immediately on any suspicion the key was exposed.

```bash
# 1. OFFLINE, on the owner's machine. Writes the private key to the file and
#    prints the PUBLIC key on stderr — only the public key is ever shown.
umask 077
age-keygen -o wcs-backup-age-2027-10.key
#    -> "Public key: age1....."   <- this is the only line you copy anywhere
```

2. Set the new recipient in CI. `gh` prompts for the value, so nothing is
   typed on a command line or into shell history:

```bash
gh secret set AGE_PUBLIC_KEY -R Anish-1205/wcs-backup-ops
# paste the age1... public key at the prompt
```

3. Run a backup and **drill it with the new key** before trusting anything:

```bash
gh workflow run backup.yml -R Anish-1205/wcs-backup-ops -f mode=backup -f force=true
gh run watch -R Anish-1205/wcs-backup-ops --exit-status
node scripts/restore-drill.mjs --run <new-run-id> --key ./wcs-backup-age-2027-10.key
```

4. Distribute the new key to all three custody locations and test-decrypt
   each one (above).

5. **Keep the old key until the last artifact encrypted with it has
   expired.** Do not destroy it on rotation day.

### How old artifacts stay readable during the changeover

Each artifact is encrypted to whichever public key was in CI when it ran, so
after rotation the artifact list is mixed. Two things make that safe:

- **`age -d` accepts several identities** and tries each one:
  `age -d -i wcs-backup-age-2026-10.key -i wcs-backup-age-2027-10.key -o bundle.tar <artifact>`.
  Keep both files side by side for the overlap and nothing has to be decided
  per artifact.
- **Retention bounds the overlap.** The longest retention is the Sunday
  copy at 56 days, so 56 days after the first new-key backup no old-key
  artifact is still alive. Check rather than assume:

```bash
gh api repos/Anish-1205/wcs-backup-ops/actions/artifacts \
  --jq '.artifacts[] | select(.expired==false) | "\(.name)\t\(.created_at)\t\(.expires_at)"'
```

Once every live artifact post-dates the rotation, destroy the old key in all
three locations (`shred -uz`, and physically destroy printed or USB copies).
Record the date. Until then, an old key that is "retired" is still a key
that must be kept under the same rules as the current one.

---

## Loss procedures

### The `age` private key — all copies gone

**This is the unrecoverable one.** Existing artifacts cannot be decrypted by
anyone, including Supabase and GitHub. There is no escrow at either provider
and no recovery path.

1. Accept that every existing backup is permanently lost. Do not spend time
   on recovery attempts; there are none.
2. Generate a new keypair and set `AGE_PUBLIC_KEY` **the same day**
   (rotation steps 1–2 above).
3. Run a backup immediately with `force=true`, then drill it.
4. Distribute the new key to all three locations and test-decrypt each.
5. Treat RPO as broken from the moment of the loss back to the beginning:
   record the incident with dates, and note in
   [backup-restore.md](backup-restore.md)'s drill log that no artifact
   predating the new key is recoverable.
6. Delete the now-unreadable artifacts so nobody later mistakes them for a
   recovery option.

If only *some* copies are lost, this is not an incident: replace the missing
copies from a good one and test-decrypt all three.

### Lost or forgotten database password

Does not lose data — Postgres stores a hash, so the password is reset, not
recovered.

1. Supabase dashboard → Settings → Database → reset the password for the
   role concerned (or the SQL below for `backup_reader`).
2. Update every place the old value was stored: the vault, the ops repo's
   `BACKUP_DATABASE_URL`, `DATABASE_URL` in Vercel (if set) and in
   `.env.local`.
3. Run a backup with `force=true` and confirm it is green — that is the
   test, and a failure here is exactly what T1.11's watchdog is for.

### Lost GitHub access

The artifacts live in a GitHub private repo, so this is an availability
loss, not a data loss — but it blocks recovery.

1. Use the account recovery codes kept **offline** (not in the vault that
   may need the same 2FA). Generate them now if they do not exist:
   GitHub → Settings → Password and authentication → Recovery codes.
2. Failing that, the **second ops-repo admin** (custody decision above) can
   reach the artifacts and re-add the owner. This is the whole reason that
   decision is "yes".
3. Failing both, GitHub account recovery is the only route and is slow.
   Meanwhile the database itself is untouched: the site keeps running, and a
   fresh backup can be taken to a new repo.

### Lost Vercel access

1. Account recovery via the login email, then recovery codes.
2. The site keeps serving while access is being recovered — Vercel does not
   stop a deployment because nobody is logged in.
3. If access cannot be recovered: the repo is the source of truth. Create a
   new Vercel project, import the repo, re-enter the environment variables
   from the vault (the names are in
   [backup-restore.md](backup-restore.md)'s L1 table) and re-point DNS.

### Lost Supabase access

The serious one after the age key, because the live database is there.

1. Account recovery via the login email and recovery codes.
2. While locked out, the site keeps serving — the app authenticates with
   keys, not with a dashboard session. Avoid anything that would need a
   dashboard (no migrations, no role changes).
3. If access cannot be recovered, this becomes an **L0 restore into a new
   project** ([backup-restore.md](backup-restore.md)) using the most recent
   artifact. That is the scenario the whole backup chain exists for, and it
   is why the age key's custody matters more than the Supabase password.

---

## `backup_reader` rotation and revocation

Rotate the password yearly alongside the key, and immediately if the ops
repo's secrets could have been exposed.

### Rotate the password

Run in the Supabase SQL Editor. Generate the password in the password
manager and paste it in; do not invent one by hand and do not put it in a
file that is not shredded afterwards.

```sql
alter role backup_reader with password '<new strong password>';
```

Then update the secret. `gh` prompts for the value, so the URI never reaches
the command line, shell history or a log:

```bash
gh secret set BACKUP_DATABASE_URL -R Anish-1205/wcs-backup-ops
# paste at the prompt:
# postgresql://backup_reader.<project-ref>:<new password>@<pooler host>:5432/postgres?sslmode=require
```

Port **5432** (session mode). Transaction mode on 6543 is not usable here.

**Test, then trust** — the secret is write-only once set, so the only way to
know it is right is to use it:

```bash
gh workflow run backup.yml -R Anish-1205/wcs-backup-ops -f mode=backup -f force=true
gh run watch -R Anish-1205/wcs-backup-ops --exit-status
```

A green run proves the new URI connects, dumps and encrypts. If it fails,
the old password is already gone, so fix the secret rather than rolling
back. Finish by drilling the artifact
(`node scripts/restore-drill.mjs --run <run-id> --key …`), because a backup
that is not restorable is not a backup.

If `gh` cannot prompt (a non-interactive shell), use a file and shred it —
never `--body`, which puts the value in shell history:

```bash
umask 077
# paste the URI into url.txt with an editor, not with echo
gh secret set BACKUP_DATABASE_URL -R Anish-1205/wcs-backup-ops < url.txt
shred -uz url.txt
```

### Revoke it (suspected compromise)

In this order — stop the credential working before removing the data it
could reach:

```sql
-- 1. Stop it logging in at all. Keeps the grants, so re-enabling is one
--    statement; does not touch any data.
alter role backup_reader with nologin;
```

```bash
# 2. Remove the secret so no workflow run can use it.
gh secret delete BACKUP_DATABASE_URL -R Anish-1205/wcs-backup-ops
# 3. Decide about the artifacts. They are encrypted to the age key, so a
#    leaked DB credential does not make them readable — delete them only if
#    the AGE KEY is also suspected, and only after the new chain is proven.
gh api repos/Anish-1205/wcs-backup-ops/actions/artifacts \
  --jq '.artifacts[] | select(.expired==false) | "\(.id)\t\(.name)"'
```

Then rotate: set a new password, set the secret, run a backup, drill it. To
remove the role entirely (only if the backup approach is being abandoned):

```sql
drop owned by backup_reader;
drop role backup_reader;
```

Note that `drop role` will fail while the role holds grants — `drop owned
by` first, as above. Re-enabling instead is just
`alter role backup_reader with login;`.

---

## Secret inventory

**Names and locations only. No values, ever, in this repo.** Values live in
the password manager.

| Name | Lives in | Notes |
| --- | --- | --- |
| `AGE_PUBLIC_KEY` | ops repo secret | Public. Safe to store anywhere. |
| age **private** key | vault + offline medium + escrow | Three copies. Never in CI. The whole backup chain depends on it. |
| `BACKUP_DATABASE_URL` | ops repo secret + vault | `backup_reader`, session pooler, port 5432. Read-only but `BYPASSRLS`. |
| `backup_reader` password | vault | Component of the above; rotate together. |
| Supabase DB password (`postgres`) | vault | Privileged. Needed for the SQL Editor route and `DATABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env + `.env.local` | Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env + vault | Bypasses RLS. Treat as a root credential. |
| `DATABASE_URL`, `DATABASE_CA_CERT` | Vercel env + vault (optional) | Raw Postgres, bypasses RLS entirely, runs DDL. |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Vercel env + vault | Media store; assets survive a database loss. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Vercel env + vault | Rate limiting. |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Vercel env + vault + Meta app | Webhook trust boundary. |
| `RESEND_API_KEY` | Vercel env + vault | Email notifications. |
| `ANTHROPIC_API_KEY` | Vercel env + vault | Import/ingest AI. Optional. |
| `CRON_SECRET`, `HEALTH_TOKEN` | Vercel env + vault | Guard `/api/whatsapp/sweep` and `/api/health`. |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel env | Public by design. |
| `ADMIN_EMAILS` | Vercel env | Not a secret, but security-relevant: it is the admin allowlist. |
| Google OAuth client id/secret | Supabase Auth provider + Google Cloud + vault | Customer sign-in. |
| GitHub account recovery codes | **offline**, not the vault | The vault may need the same 2FA. |
| Vercel / Supabase / Cloudinary / Upstash / Resend recovery codes | vault + offline | One copy must be outside the vault. |

The authoritative list of what the application *requires* is
`scripts/check-env.mjs` — `npm run check:env` before any first deploy to a
new environment.

---

## Calendar reminders

Set these as recurring events with the owner as the only attendee. Each one
names the procedure in this file.

| When | What | Section |
| --- | --- | --- |
| **Quarterly** (Jan / Apr / Jul / Oct, 1st) | Test-decrypt **each** of the three key copies; log the date | [Quarterly test-decrypt](#quarterly-test-decrypt) |
| **Quarterly** | Full restore drill on an artifact at least a day old | [backup-restore.md](backup-restore.md) |
| **Quarterly** | Confirm the GitHub account still has **no payment method** on file — that absence, not an alert, is the spend cap | [backup-scope.md](backup-scope.md) |
| **Quarterly** | Confirm the second ops-repo admin still has access | [Custody decisions](#custody-decisions) |
| **Yearly** (October) | Rotate the `age` keypair; keep the old key until every live artifact post-dates the rotation | [Yearly key rotation](#yearly-key-rotation) |
| **Yearly** (October) | Rotate the `backup_reader` password; re-run a backup and drill it | [`backup_reader` rotation](#backup_reader-rotation-and-revocation) |
| **Yearly** | Re-generate and re-store account recovery codes for GitHub, Vercel, Supabase | [Secret inventory](#secret-inventory) |
| **56 days after a key rotation** | Confirm no old-key artifact is still live, then destroy the old key everywhere | [How old artifacts stay readable](#how-old-artifacts-stay-readable-during-the-changeover) |
| **On any suspected exposure** | Rotate immediately; do not wait for the yearly date | [Loss procedures](#loss-procedures) |

---

## Owner steps still outstanding

Nothing below can or should be done for you — each one either handles the
private key or needs an account only you control.

1. **Save copy 1** of the private key into the password-manager vault.
2. **Save copy 2** onto an offline medium kept away from the laptop.
3. **Place copy 3 in escrow** (trusted person or safe), key only — no
   account credentials, no repo location.
4. **Test-decrypt all three copies** using the commands above.
5. **Add the second admin** to `Anish-1205/wcs-backup-ops`.
6. **Confirm GitHub billing** has no payment method on file, so exhausted
   minutes or storage block instead of billing.
7. **Generate and store offline** the GitHub account recovery codes.
8. **`shred -uz C:\Users\anish\wcs-backup-age.key`** — only after step 4
   passes. From then on, copy the key out of the vault for a drill and
   shred the working copy afterwards.
9. **Put the calendar reminders in** the calendar.
