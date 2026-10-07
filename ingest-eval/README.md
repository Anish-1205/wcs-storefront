# WhatsApp ingestion replay

Replays invented, messy WhatsApp traffic through the shipped ingestion path on a **real, local, throwaway PostgreSQL** and judges the result against ground truth. Local only: it refuses any host but `127.0.0.1`, never reads `DATABASE_URL`, and no production captions, ids or phone numbers are in the fixtures.

```
node ingest-eval/build-fixtures.mjs   # regenerate ingest-eval/fixtures/*.json (deterministic)
npm run eval:ingest                   # replay every fixture, print the report (never fails on a rule)
npm run test:ingest                   # guarantees: same-second shuffle x100, replay twice, questions and answers, admin-only data (needs the cluster)
node ingest-eval/print-report.mjs baseline --only=F1,F4   # re-read a saved report
```

Needs the cluster `scripts/verify-p0.mjs` uses (data dir `reports/health-check/pgdata`, port 55432):

```
pg_ctl -D reports/health-check/pgdata -o "-h 127.0.0.1 -p 55432" start     # and `stop -m fast` after
```

A template database with every `supabase/migrations/*.sql` applied is built once per migration set (a new migration builds a new one) and cloned per run.

## What is real and what is mocked

| Real | Mocked |
|---|---|
| `POST /api/whatsapp` (signature check, `extractMessages`), `whatsapp-pipeline.ts`, `whatsapp-caption.ts`, `whatsapp-enrichment.ts`, `style-guide.ts` | Meta Graph (media lookup/download, replies), Cloudinary (signed upload), Sentry |
| All SQL: `enqueue_whatsapp_messages`, `whatsapp_regroup`, `claim_next_whatsapp_message`, `complete_whatsapp_message`, replies, sweep | AI: `off` (the null provider) or `oracle` (answers from the fixture's ground truth, with the real provider's 4-/20-image caps) |

Time is virtual: there is no sleeping. Postgres' `now()` cannot be faked, so "time passes" by moving every stored timestamp for the sender into the past (`shiftTime`). The scheduler is **ideal**: whenever `whatsapp_next_wake` says something is due, the replay jumps there and sweeps. Production only gets this from each webhook's 115s linger plus one daily cron, so this is the best case.

## Fixtures

Event streams: `{ id, type, sent, arrive, text?, sha256?, truth }`, in whole seconds. Timing follows production percentiles (forward items 0-1s apart, a description 1-22s after its photos, media received 2-6s after it was sent and texts 1-3s after). `truth` is for the judge only. No sticker and no "forwarded" flag: the route drops stickers, so they are not a signal.

| Stream | Shape |
|---|---|
| F1 | description, 7 pink, 2 videos, 12 red/pink, description, in one forward |
| F2 | collage, 8 pink, 8 red, description |
| F3F4, F3F4_long | 6 indigo with no description, then F4 starts 25s / 40min later |
| F4 | collage, 7 purple, description with the price on its own line |
| F5 | F4 + 3 exact duplicates + 3 recompressed + 14 extras (28 media) |
| MEDIA_ONLY | photos, never a description |
| DF1, DF_late, DF_two, DF_ambiguous | description first |
| LATE_TEXT | description 17s after its photos, after an open description-first listing |
| TIE_DF, TIE_PF | a description sharing its second with its whole photo burst |
| SKEW | a description stamped 2s BEFORE the photos it was forwarded with (3 of 20 measured descriptions), then the next listing's photos, whose description is a minute late |
| PF1, PF_late | photos first |
| TXT01-15 | messy descriptions (caps, emoji, Hinglish/Telugu-English, typos, no price, two prices, price mid-text, trailing phone number, decimal) with one photo |

## Rules

`ingest-eval/lib/rules.ts`. `MAX_IMAGES` (visible images per listing, videos excluded) is a **proposal** (20); nothing in the code defines one yet. Override with `INGEST_MAX_IMAGES`.

## Rubric changelog

`evaluate(stream, snapshot, ai, rubric)` scores with the rubric in force (`"new"`, the default) or the one the baseline was first scored with (`"old"`). Every report stores both (`findings`, `findingsOld`) and `print-report.mjs` prints both pass counts, so a gain from the pipeline is never confused with a gain from the rubric.

Three rules changed between the baseline and Step 2. Nothing else did; re-scoring the saved baseline/step1 snapshots with the current rules changes only these findings.

1. **Name length: 3-8 words became 2-8.** "Paithani Saree" is a correct name for "paithani sarees 7490"; a third word could only be invented. Affects TXT07, TXT12, TXT13 (AI off).
2. **Text that names nothing (`expect.generic`, TXT11).** Old: judged like any other listing, so it could never pass. New: with AI off the name must be exactly "Saree" and the description empty (flagged for review); with AI on, the usual name rules apply and the description must still be empty.
3. **Description: the "copies N words verbatim from the admin's text" rule was removed.** Step 2's contract is that a description is made only from the admin's own words, so a long shared run is the intended result. Still failing: the whole text returned unchanged, prices/phone numbers, emoji, ALL CAPS, urgency wording, repeated punctuation, no capital/full stop. In the old rubric the shared-run threshold is reconstructed as 8 consecutive words (the original constant was not kept; the one recorded hit was a 10-word run on TXT05).

A fourth change came with Step 3 (and is the only one since):

4. **A question is allowed where only the photos can tell (`expect.ask_without_ai`, F3F4), when there is no AI.** Old: `no_question_asked` applied to F3F4 in both modes, which could only pass by merging or separating on timing alone. New: with AI off, asking about the older burst is the correct answer (it is still never merged without a reply); with AI on, no question is allowed. Also new in Step 3: `needs_review` is checked where a fixture expects a stored reason (`expect.review`), new rubric only.

Two more came with Step 5, both because the old rule could not describe the new behaviour at all:

5. **Hidden media is kept, not lost (`no_lost_media`).** Old: a photo/video counted as lost unless it was a visible image of some product, so F5 (28 media, 20-image cap) could never pass `no_lost_media` and `within_image_cap` together. New: a duplicate or an extra that sits in `variant_hidden_media` for its product is accounted for.
6. **Description length.** Old: at most 400 characters (every description was one line). New: at most 900 characters and 120 words, because a written description is 60-120 words in two short paragraphs. Everything else about a description is judged as before.

New-rubric-only rules added in Step 5 (they have no old-rubric counterpart, so they change the new total, not the old one): `collage_placed` (the "all colours" collage is labelled and sits second or last in the first colour), `ai_call_budget` (at most one listing call per description; a retry would show up here) and `needs_review` (Step 3).

## What the oracle is, and is not

`ai=oracle` answers the single listing call (`AiProvider.analyzeListing`) from ground truth: which image belongs to which description, which one is the collage, the body colours, and copy built only from the admin's words. It is shown only the thumbnails the pipeline would send (12 at most) and nothing else. It measures what the pipeline does with a correct answer. It says nothing about how often a real model gives one: that needs the manual WhatsApp script in the final report.

`state.analysisOverride` (see `curation.test.ts`) makes it misbehave on purpose: wrong names, injected instructions followed, no answer at all.

Photos are synthetic 32x32 images (`lib/mocks.ts`): one body colour under a brightness pattern unique to the photo, four colour stripes for a collage, and the original's pattern for a recompressed near-duplicate. They exercise the real dHash, colour-match and multi-colour code, but they are not sarees: the pixel heuristics (near-duplicate threshold, collage guess without AI) are only proven on these.
