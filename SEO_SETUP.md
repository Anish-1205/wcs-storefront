# SEO setup — Weavers Club Sarees

Manual steps the site owner needs to do outside the codebase, plus how the code-side SEO system works. See [docs/storefront-catalogue.md](docs/storefront-catalogue.md) for the storefront/data model this all sits on top of.

## Google Search Console

1. Add `https://weaversclubsarees.com` as a **Domain property** (or a URL-prefix property if you don't control DNS).
2. Verify ownership. The easiest option here: generate an **HTML tag** verification token in GSC, then set it as an environment variable:
   ```
   GOOGLE_SITE_VERIFICATION=your-token-here
   ```
   (in Vercel: Project → Settings → Environment Variables). Redeploy — `src/app/layout.tsx` reads this and emits `<meta name="google-site-verification">` automatically. No code change needed.
3. Submit the sitemap: Search Console → Sitemaps → add `https://weaversclubsarees.com/sitemap.xml`.
4. Use **URL Inspection** on: the homepage, `/catalog`, `/collections/banarasi-sarees`, `/collections/bandhej-sarees`, and a couple of real product pages (`/sarees/<slug>`) — request indexing after any major content/metadata change.

## Bing Webmaster Tools

1. Add the site in Bing Webmaster Tools (you can also *import* directly from an already-verified Google Search Console property — usually the fastest path).
2. If verifying manually, generate a meta-tag token and set:
   ```
   BING_SITE_VERIFICATION=your-token-here
   ```
   `layout.tsx` emits `<meta name="msvalidate.01">` automatically when this is set.
3. Submit `https://weaversclubsarees.com/sitemap.xml` the same way as GSC.

## IndexNow

Lets Bing (and other IndexNow-participating engines) know about a changed URL immediately, instead of waiting for their next crawl.

1. Generate a key: any random 8–128 character hex string (e.g. `openssl rand -hex 16`).
2. Set it as an environment variable:
   ```
   INDEXNOW_KEY=your-generated-key
   ```
3. The key-verification file is served automatically at `https://weaversclubsarees.com/<INDEXNOW_KEY>.txt` by `src/app/[key]/route.ts` — nothing else to deploy.
4. After publishing a catalog change (new product, new collection, price/availability update), run:
   ```
   npm run indexnow
   ```
   With no arguments it submits every URL currently in `/sitemap.xml`. To submit only specific pages:
   ```
   npm run indexnow -- https://weaversclubsarees.com/sarees/new-slug
   ```
   This is a **manual step** — the file-driven catalog has no CMS/publish action to hook an automatic trigger into, so running it after a deploy is the honest way to do this without a brittle auto-trigger.

## Analytics

Already wired (`src/components/layout/Analytics.tsx`), env-gated — set whichever you use:

```
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXX
NEXT_PUBLIC_CLARITY_PROJECT_ID=xxxxxxxxxx
NEXT_PUBLIC_PINTEREST_TAG_ID=xxxxxxxxxx
```

**WhatsApp conversion tracking**: every WhatsApp CTA on the site (product page, float button, banner, homepage, about, contact, wholesale) now goes through `src/components/whatsapp/WhatsAppLink.tsx`, which fires a `whatsapp_click` GA4 event with `source_page` (and `product_id`/`variant_color` where relevant) on click. To verify: open GA4 → Configure → DebugView with `NEXT_PUBLIC_GA_MEASUREMENT_ID` set locally, click a WhatsApp CTA, confirm the event appears.

## Textile collection pages — current scope and backlog

`/collections/banarasi-sarees` and `/collections/bandhej-sarees` were added because they're the only textile types with enough real inventory (8 and 5 products respectively, via the `weave`/`tags` fields in `src/data/products.ts`) to avoid a thin-content page. Deferred until inventory grows:

| Proposed collection | Real matching products today |
|---|---|
| Tissue sarees | 2 |
| Georgette sarees | 3 |
| Paithani sarees | 0 (one product only says "Paithani-inspired" in prose) |
| Wedding sarees | 1 (tagged "Bridal") |
| Festive sarees | 1 (tagged "Festive") |

Adding one once inventory justifies it: append an entry to `COLLECTIONS` in `src/data/collections.ts` with the matching `productSlugs` — the existing `/collections/[slug]` route needs no changes.

## Guides — two published, more to come

`src/data/guides.ts` / `src/app/(public)/guides/**` are live with two real articles: **What Is a Banarasi Saree?** and **Bandhej vs Bandhani**. Both use only well-established, generic textile facts plus exact copy already verified in `src/data/products.ts` (no invented claims about specific products) and link to the `banarasi-sarees`/`bandhej-sarees` collections. `/guides` is now in the main nav (shown from the `xl` breakpoint up on desktop — see the nav-width note below) and indexable (the index page's `robots.index` flips on automatically once `GUIDES` is non-empty).

Adding another guide: append a `Guide` object to `GUIDES` with real, non-fabricated body copy and (optionally) real `relatedCollectionSlugs`/`relatedProductSlugs`.

Candidate topics, prioritized by which real products/collections they'd link to:

- **Understanding Zari** → Banarasi collection + any product with zari motifs in its description
- **How to Care for Silk Sarees** → any silk-material product
- **Guide to Kota Tissue Sarees** → `coral-tissue-paithani-pallu`, `antique-gold-patola-tissue`
- **How to Style a Tissue Saree** → same two products
- Backlog (write once matching inventory exists or a genuine expert supplies the copy): What Is Munga Silk?, What Is Paithani?, Banarasi vs Kanjivaram, How to Choose a Saree for a Wedding, Best Saree Colours for Day/Evening Weddings, How to Identify Saree Fabrics, Saree Blouse Colour Pairing, Festive Saree Styling, Wedding Guest Saree Guide, How to Fold and Store Premium Sarees, Indian Saree Weaving Traditions.

## Pinterest save buttons

Every non-thumbnail product image (hero + full-width narrative shots, not the small paired detail/colourway grids) now has a small "Save" chip (top-right corner) that opens Pinterest's own `pin/create/button` flow with the image, product page URL, and product name/reference pre-filled — no Pinterest SDK/script needed. Fires the existing `pinterest_share` GA4 event (`src/lib/analytics.ts`) on click. Component: `src/components/product/PinterestSaveButton.tsx`.

## Social profiles

Both confirmed and hardcoded in `SITE_LINKS`/`SOCIAL_LINKS` (`src/lib/site.ts`): Instagram (`https://www.instagram.com/weaversclub/`) and Facebook (`https://www.facebook.com/Sarisstop/`, verified as the "Weavers' Club Sarees | Navi Mumbai" page). Shown as icon links in the site footer (`src/components/layout/Footer.tsx`) and included in Organization + LocalBusiness JSON-LD `sameAs`. Add another platform by appending a `{ label, url }` entry to `SOCIAL_LINKS` — the footer and both JSON-LD blocks pick it up automatically.

## Nav width budget

The desktop nav bar (`src/components/layout/Navbar.tsx`) was already tight at md (768px) and lg (1024px, a real iPad-landscape width) before this round — both already clipped the "Speak to Us" link slightly. The new "Guides" link is shown only from `xl` (1280px) up on the desktop bar (`xlOnly` flag on its `NAV_LINKS` entry in `src/lib/site.ts`) so it doesn't make that pre-existing overflow worse; it's still in the mobile drawer at every width. If you add more nav items in future, verify at 768/1024/1280/1440 first (Playwright + a viewport screenshot, or your browser's device toolbar) — this bar has no slack left below 1280px.

## Known TODOs / not invented

- **Organization `contactPoint`** (phone) — no real number in the codebase to add. Wire it into `src/app/layout.tsx`'s Organization JSON-LD the same way `SITE.gstin` is (an optional env var, omitted when unset) once you have one you want listed publicly.
- **Google/Bing favicon showing a generic globe instead of the WCS logo** in search results — checked live: `src/app/icon.png` is a correctly-sized (512×512, square) PNG, properly linked (`<link rel="icon">`), not blocked by robots.txt. This isn't a code bug — Google's own docs note favicon refresh in search results can lag days to weeks behind a site relaunch/rebrand, independent of content indexing. After requesting reindexing of the homepage (see URL Inspection above), this should resolve on its own; no further action needed unless it's still showing the globe after a few weeks.
- **Legacy-URL redirects** — no product slug has ever been renamed, so no `redirects()` entries exist in `next.config.mjs`. If a slug is ever renamed, add a permanent redirect there:
  ```js
  async redirects() {
    return [{ source: "/sarees/old-slug", destination: "/sarees/new-slug", permanent: true }];
  }
  ```
- **Rich textile attributes** (zari type, pallu type, saree dimensions, care instructions, verified origin/region) — none of this exists in `src/data/products.ts` today (`origin` is `null` on every product). Don't add these to JSON-LD/product pages until the business supplies real values — see the "NOTHING HERE IS INVENTED" note at the top of `products.ts`.

## Ongoing monthly workflow

1. Search Console → Overview: check for new errors.
2. Indexing → Pages: check for newly-excluded pages.
3. Core Web Vitals: any regressions on mobile/desktop.
4. Security & Manual Actions: confirm clean.
5. Performance → Search results: review query-level impressions/clicks.
6. Find pages with high impressions but low CTR — improve their title/description.
7. Find pages ranking roughly position 5–20 — these are closest to a page-two-to-page-one jump; improve on-page content/internal links to them.
8. Add a new guide (or expand a collection) based on real customer search queries surfaced in step 5, once there's inventory/content to support it.
