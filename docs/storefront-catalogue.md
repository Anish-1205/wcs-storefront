# Storefront catalogue (file-driven) + enquiry cart

This documents the public storefront as it was rebuilt in Sept 2026 around the
client's real WhatsApp photo/video library. It replaces the Supabase-backed
public catalog for `src/app/(public)/**`. **The admin panel and import pipeline
(`src/app/admin/**`, `src/lib/queries.ts`, all of Supabase/Cloudinary) are
unchanged** — the two halves of the app now have separate data sources on
purpose.

```
                         PUBLIC STOREFRONT                 ADMIN
  data source        src/data/products.ts            Supabase (Postgres)
                     src/data/collections.ts
  media              public/media/<slug>/            Cloudinary
  conversion path    cart -> /enquiry -> WhatsApp     inquiry form / WhatsApp
```

There is **no payment gateway** anywhere in the storefront. The cart is an
enquiry basket; checkout is a pre-filled WhatsApp message.

---

## 1. Adding or editing a product

Everything the storefront shows comes from **`src/data/products.ts`**
(`SEEDS: ProductSeed[]`). To add a product:

1. Put its photos/videos in the source folder (default
   `C:/Users/anish/OneDrive/Desktop/wcs pics`).
2. Add a `slug -> { images, videos }` block to the `MAP` in
   [`scripts/prepare-media.mjs`](../scripts/prepare-media.mjs). Each entry is
   `["<raw source filename>", "<output name>"]`. Output names follow the
   convention `NN-role.jpg` (`01-full`, `04-pallu`, `07-border-detail`, …).
3. Run the media pipeline (section 3).
4. Add one `ProductSeed` object to `SEEDS`. Use the `img()` / `video()` helpers
   so intrinsic dimensions are read from the generated JSON (this is what keeps
   layout shift at zero).

`PRODUCTS` is derived from `SEEDS` — `category` / `categorySlug` are set
automatically from `colourFamily`. Helper functions (`getAllProducts`,
`getProductBySlug`, `getAllSlugs`, `getFeaturedProducts`, `getRelatedProducts`,
`getCategories`, `filterProducts`, `primaryImage`, …) are all in the same file.

### The "nothing is invented" rule

The client did not supply weave, fibre, region, price or verified availability
for any piece. Enforced consequences:

| Field | Value | Renders as |
|---|---|---|
| `weave`, `material`, `origin` | `null` | product page shows *"Weave, fabric and finishing details are confirmed personally on enquiry."* |
| `price` | `null` | "Price on Enquiry" — never a `₹0` line, never a fake subtotal |
| `availability` | `"on-request"` | "Availability on Request" — never "In Stock" |
| `title`, `description`, `details` | describe only what is **visible** — colour, motif, drape, what's included | — |

**No named weave / region / fibre appears in any customer-facing string**
(no "silk", "tissue", "Banarasi", "Bandhani", "Patola", "Ikat", "Paithani", …).
The catalogue is browsed **by colour** (`category` mirrors `colourFamily`) because
colour needs no verification. When the client provides a verified taxonomy, add a
second category axis — no page component needs to change.

**Known gap:** the internal `slug`s and `public/media/<slug>/` folder names still
contain descriptive words like `patola` / `jamdani` / `tissue`. They appear in
product URLs (`/sarees/purple-tanchoi-silk`). They are *not* rendered as text
anywhere, but if strict URL cleanliness matters they should be renamed in one
pass together with the client's real product taxonomy (renaming touches
`products.ts`, `collections.ts`, `prepare-media.mjs` and the media folders).

### Collections

`src/data/collections.ts` — three hand-curated lists of product slugs with a
cover image reused from a product. Labels describe only what is visibly shared
(*One Border, Many Grounds* / *Light & Ornamental* / *Print & Handwork*).

---

## 2. Media

```
public/media/
  <slug>/
    01-full.jpg 02-drape.jpg ... NN-role.jpg      # prepared stills
    video-1.mp4 [video-2.mp4]                     # optimised clips
  dimensions.json          # { slug: { file: { w, h } } }         -> img()
  video-dimensions.json    # { slug: { file: { w, h, bytes } } }  -> video()
  hero-poster.jpg          # 560w still for the homepage hero video
  og.jpg                   # 1200x630 social share image
```

- `dimensions.json` / `video-dimensions.json` are **generated** — do not
  hand-edit unless you also change the corresponding media file. They are
  imported directly by `products.ts` (`resolveJsonModule` is on) so every
  `<Image>` / `<video>` reserves its exact box.
- Portrait media is never cropped to landscape. `PortraitImage` /
  `PortraitVideo` (`src/components/media/PortraitMedia.tsx`) hold the aspect
  ratio and letterbox rather than distort.
- 3 celebrity photos in the source library are intentionally excluded.
- `indigo-blockprint-modal-silk` originally had two videos; the `13.33.56` clip
  was a **different, unidentified gold saree** and was removed. If the client
  identifies it, add it back via `prepare-media.mjs`.

### Video weight

| | Before | After |
|---|---|---|
| Clips | 9 | 8 |
| MP4 total | 53.6 MB | ~29 MB |
| `public/media` total | 79 MB | 55 MB |

`public/media` **is committed** (~55 MB, not gitignored). Fine for launch; move
to Cloudinary or git-lfs if the repo size becomes a problem.

---

## 3. Pipeline scripts

Run from the repo root, in order, whenever source media changes:

```bash
node scripts/prepare-media.mjs "C:/Users/anish/OneDrive/Desktop/wcs pics"
node scripts/optimize-video.mjs
```

- **`prepare-media.mjs`** (sharp) — resizes stills (long edge <= 1600 px,
  quality 82, EXIF-rotate then strip metadata), copies videos verbatim, writes
  `dimensions.json`. **No colour / hue / saturation changes** — colour fidelity
  matters for a textile business.
- **`optimize-video.mjs`** (ffmpeg-static / ffprobe-static, both devDeps) —
  re-encodes each MP4 at H.264 CRF 28, strips the unused audio track, enables
  `+faststart`. **No resolution change, no filters** (`yuv420p`, same as source).
  Only replaces a file if the result is smaller. Writes `video-dimensions.json`.

Poster/OG images (`hero-poster.jpg`, `og.jpg`) were generated ad-hoc with sharp;
regenerate them by hand if the hero or the featured share image changes.

---

## 4. Cart

`src/lib/cart/CartContext.tsx` — React context, client-only, persisted to
`localStorage` under `wcs.cart.v1`.

- **Persistence is synchronous** on every change (`writeStorage(items)` inside
  the `useEffect`). It was previously debounced; the debounce dropped writes when
  the provider unmounted during navigation. Do not reintroduce a debounce — the
  payload is a few hundred bytes.
- Hydrates once on mount; a `storage` event listener keeps other tabs in sync.
- `CartButton` shows `0` until hydrated to avoid a hydration mismatch.
- `add()` opens the drawer. `MAX_QTY = 20`. Setting qty <= 0 removes the line.
- `CartItem` (`src/lib/cart/types.ts`) carries `price: number | null` — priced
  and "Price on Enquiry" items coexist; totals only appear if **every** line is
  priced.

---

## 5. Enquiry -> WhatsApp handoff

Flow: **cart drawer -> "Confirm Availability" -> `/enquiry` (form) ->
`/enquiry/sent`**.

`src/components/enquiry/EnquiryForm.tsx`:

1. `e.preventDefault()`, double-submit guard (`submitting` ref).
2. Validate (name >= 2, phone >= 7 digits, city >= 2). On error: set messages,
   `aria-invalid`, move focus to the first invalid field.
3. **Open WhatsApp synchronously, inside the click gesture, before any
   `await`** — `window.open(waUrl, "_blank", "noopener,noreferrer")`. Opening it
   after an `await fetch(...)` gets popup-blocked.
4. Write a snapshot to `sessionStorage["wcs.enquiry.v1"]` (`{ waUrl, configured,
   items, customer, ts }`).
5. Fire-and-forget `fetch("/api/inquiries", …).catch(() => {})` — a failed
   notification must never block or alarm the customer.
6. `router.push("/enquiry/sent")`. **The cart is NOT cleared here.**

`/enquiry/sent` (`EnquirySent.tsx`) reads the snapshot and shows **"Open WhatsApp
Again"** + **"Return to Catalogue"**. The cart is cleared **only** when the
customer clicks the WhatsApp link — so a blocked popup never loses their
selection. No-snapshot and WhatsApp-not-configured both get graceful on-brand
fallbacks (email / `/contact`).

### WhatsApp configuration — one source of truth

`src/lib/whatsapp.ts`:

- `WHATSAPP_NUMBER` = `NEXT_PUBLIC_WHATSAPP_NUMBER` stripped to digits.
- `WHATSAPP_CONFIGURED` = 10–15 digits (E.164).
- If missing/invalid: a dev-only `console.warn`, and every WhatsApp CTA falls
  back to `WHATSAPP_FALLBACK_HREF` (`/contact`) — never a broken `wa.me/?text=`.
- `wa.me` links (WhatsApp redirects these to `api.whatsapp.com`) are used
  everywhere; message bodies are built by `buildEnquiryMessage()` /
  `buildWhatsAppURL()` and URL-encoded once via `encodeURIComponent`.
- Every enquiry line and the message include `Ref: WCS-00X`.

Concierge copy lives in `src/lib/copy.ts` (`CONCIERGE_NOTE`,
`CONCIERGE_PARAGRAPH`, `AVAILABILITY_LINE`) — "availability is personally
confirmed", "no payment is collected online at this stage". Never wording that
sounds like a stock system is down.

---

## 6. Environment variables

`NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_BUSINESS_NAME` and
`NEXT_PUBLIC_SITE_URL` are already in the required set checked by
`scripts/check-env.mjs`. Storefront-specific notes:

| Var | Required | Purpose | Format |
|---|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | **yes** | the single WhatsApp number | digits only, country code, no `+`/space/`-` — e.g. `919876543210` |
| `NEXT_PUBLIC_SITE_URL` | **yes for prod** | canonical + OG URLs | deployed `https://` origin (not localhost) |
| `NEXT_PUBLIC_BUSINESS_NAME` | defaulted | site name, titles, JSON-LD | defaults to `Weavers Club Sarees` |
| `NEXT_PUBLIC_GSTIN` | optional | footer + contact + JSON-LD | e.g. `27AHSPV2813RIZA` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | optional | email CTAs (`src/lib/contact.ts`) | if unset, email links point to `/contact` |
| `NEXT_PUBLIC_INSTAGRAM_URL` | optional | Instagram link | full `https://` URL |

---

## 7. Routes

Public storefront: `/`, `/catalog`, `/catalog/[category]` (colour),
`/collections`, `/collections/[slug]`, `/sarees/[slug]`, `/cart`, `/enquiry`,
`/enquiry/sent`, `/search`, `/contact`, `/wholesale`, `/about`, legal pages.

`/cart`, `/enquiry`, `/enquiry/sent` are `robots: { index: false }`. Product
pages are statically generated (`generateStaticParams` from `getAllSlugs()`) with
per-page `canonical`, `Product` JSON-LD (`sku` + `mpn` = the WCS reference), and
a real product image for OG.

Search matches title / WCS reference (with or without the dash — `WCS-004`,
`wcs004`, `004`) / colour / verified metadata only. `null` fields are not indexed
as strings.

---

## 8. What the client still needs to provide

Per product in `src/data/products.ts`:

- **`price`** (`number | null`)
- **`weave` / `material` / `origin`** — currently `null`; once set they render as
  spec rows and the "confirmed on enquiry" line disappears
- **`availability`** — currently all `"on-request"`; set
  `available` / `limited` / `sold` per piece
- verified **category / collection names** (to add a weave axis alongside colour)
- which products are **`featured`** on the homepage (currently 5)
- confirm the four `bandhani-patola-*` pieces really are one design in four
  colourways (that is how they are modelled)
- identify the removed gold-saree video
  (`WhatsApp Video 2026-09-05 at 13.33.56.mp4`, still in the source folder)

---

## 9. Known issues / non-goals

- `public/media` (~55 MB) is committed. Move to a CDN / git-lfs if needed.
- Legal pages (`/privacy`, `/terms`, `/shipping-returns`) inherit the new
  nav/footer/typography but their **policy text is unchanged** — legal copy was
  not written.
- Pre-existing `npm audit`: 5 high (`next`, `postcss`, `glob`). Not introduced by
  this work; `audit fix --force` wants a breaking Next 16 upgrade.
- The old Supabase-backed public components remain in the tree, unused. The admin
  panel still uses them.
- Product videos are 25–34 s ambient loops kept at full length (no content
  trimming without the client's sign-off).

---

## 10. Verification (at time of writing)

`npm run types` clean · `npm run lint` clean (1 pre-existing admin warning) ·
`npm run build` clean · `npm test` 92/92 · Playwright flow suite (cart
persist/nav/reload, qty/remove, no `₹0` totals, enquiry -> WhatsApp handoff not
popup-blocked, "Open WhatsApp Again", search by reference, mobile no-overflow at
375/390/430) all passed against a production build.
