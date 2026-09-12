# Admin Guide (Non-Technical)

This guide is for the family team managing the website day to day. No coding
needed — everything is done through the admin panel.

## Signing in

1. Go to **yourdomain.com/admin**.
2. Enter your email and password.
3. You'll land on the **Dashboard**, which shows counts of products, inquiries,
   and subscribers.

## Adding a new saree

For the current file-backed public catalog, see [Website page editing](website-pages.md)
before adding new database products. Published mirrored products can be edited in
Products, but unrelated new database rows do not automatically create storefront routes.

To edit existing public text, images and sections, open **Dashboard → Website pages**.
The [page editor guide](website-pages.md#everyday-editing) explains previews, publishing,
homepage product placement and restoring the original content.

1. Click **+ Add Product** (top right of the Dashboard or Products page).
2. Fill in the details:
   - **Name** — e.g. "Royal Gadwal Silk Saree" (the web address fills in automatically).
   - **Product code** — your own reference, e.g. `GAD-001` (optional but helpful — it appears in WhatsApp messages so you instantly know which saree a customer means).
   - **Category** — pick from the list (Gadwal, Kanjivaram, etc.).
   - **Fabric type** — e.g. "Pure Silk".
   - **Base price min / max** — the typical price range in rupees. Leave blank to show "Price on request".
   - **Description** — a few sentences about the saree.
   - **Highlights** — short selling points, **one per line**.
3. **Color variants & images** — for each color the saree comes in:
   - Click **+ Add color variant**.
   - Enter the **color name** (e.g. "Maroon") and pick the **swatch color**.
   - Set **Status** to *Available* or *Sold out*.
   - Optionally set a price just for that color (overrides the base price).
   - Click **Upload images** and choose photos for that color. The first image
     becomes the **Primary** (the one shown on the catalog). Click **Set
     primary** on any image to change it.
   - **Fixing a wrong colour split** (e.g. a WhatsApp-created product lumped
     two colours into one "Default" variant): click **+ Add color variant**
     to open an empty one, then drag a photo from the wrong variant's grid
     onto the new one's — it moves across immediately. The Color name and
     swatch re-detect automatically from whatever photos end up in each
     variant (same AI colour-detection as the import tool), unless you've
     already typed a colour in yourself, which is never overwritten.
4. **Collections** — tick any collections this saree belongs to (e.g. "Bridal
   Sarees").
5. Choose the **Status**:
   - **Draft** — not visible on the website yet (work in progress).
   - **Published** — live and visible to customers.
   - **Archived** — hidden but kept in records.
6. Tick **Feature on homepage** to show it in the homepage highlights.
7. Click **Save product**. Changes appear on the live site within seconds.

## Adding a saree via WhatsApp

If the admin WhatsApp number is connected, you can create a draft product
straight from your phone — no need to open the admin panel:

1. **Forward the photos and/or videos first**, in any order, with no caption
   on any of them.
2. **Then send one message** describing the saree and the price, e.g.
   *"Exquisite Kanjivaram-style Tissue Benarasi sarees, rich zari border...
   4900"*.
3. That message creates the product (as a **draft**, with all the photos/
   video you sent attached) and you'll get a WhatsApp reply confirming it,
   or explaining what went wrong if something failed — you always get a
   reply either way.
4. Open the admin panel to check it over and publish it when ready.

**Category, fabric, highlights and collection tags are filled in
automatically** from your description and photos, whenever confident — the
WhatsApp reply tells you what got set (e.g. *"Category: Banarasi. Collections:
Bridal Sarees."*). If a photo set clearly shows more than one colourway, it's
split into separate colour variants on the product automatically too (the
reply says *"across N colourways"* when this happens). Anything not
confident enough is simply left blank for you to fill in — same as fabric or
price, add it in the admin panel. This uses the same AI as the bulk import
tool (see [import-pipeline.md](import-pipeline.md)); if the AI key isn't
configured, everything still works exactly as before, just without the
auto-fill.

**The product's name is written for you in a consistent style** — roughly
*"[Colour] [Fabric] Saree with [Key Detail]"*, e.g. *"Ivory Tissue Saree with
Gold Zari Border"* — rather than reusing your whole message. Your full message
is still kept as the product description. Marketing words ("exquisite",
"hurry"), prices and emoji are always stripped out of the name, and a fabric or
weave is only used if you actually said it. This works even when the AI is
unavailable, so every listing reads the same way.

If you don't mention a price, the listing is created without one ("Price on
request") and you can add it later.

> **Photo tip:** Upload tall (portrait) photos, ideally **1000×1500 pixels** or
> larger. This looks best on the site and on Pinterest.

## Editing or removing a saree

- On the **Products** page, click a saree's name (or **Edit**) to change it.
- Use the **status dropdown** right in the list for a quick change
  (Draft / Published / Archived).
- Tick/untick the **Featured** box to show/hide it on the homepage.
- **Delete** permanently removes a saree. Past inquiries about it are kept.

### Finding a saree in a long list

The Products list shows one page at a time. Search, the filters and the sort all
apply to the **whole catalogue**, not just the page you're looking at, so
searching always finds the saree wherever it is. **Show 10 / 25 / 50 / 100 per
page** at the bottom left sets how many you see at once, and that choice is
remembered on this computer for next time. The page you're on is in the web
address, so you can bookmark or reload without losing your place.

## Tidying up older sarees (re-run AI naming & tagging)

Sarees added before the naming style existed — especially ones created over
WhatsApp, whose names were just the start of your message — can be brought up to
standard in place. On the **Products** page click **"Re-run AI naming &
tagging"**:

1. It lists the sarees worth improving: an off-style name, or a missing
   category, fabric, highlights or collection tags.
2. Tick the ones you want (up to 12 at a time) and click **Preview changes**.
   Nothing is saved yet — you see exactly what would change, line by line.
3. Untick anything you disagree with, then **Apply**.

What it will and won't do:

- It **never touches photos or videos**, prices, the Draft/Published status, or
  the saree's web address — so nothing breaks and no link goes dead.
- It only **fills in what's missing**. A fabric, category or highlight list you
  wrote yourself is left alone (there are checkboxes if you *do* want it
  redone), and collection tags are only ever added, never removed.
- A name that already follows the style is left as it is, so running it twice
  changes nothing the second time.
- **Category is part of every run.** A saree with no category gets one suggested
  from your real category list (never an invented one); a saree that already has
  one keeps it. Tick **"Only products with no category"** to narrow the list to
  exactly those.

## Product codes and web addresses

A separate button on the **Products** page, **"Normalise codes & web
addresses"**, tidies the two identifiers the AI tool deliberately won't touch.

1. It lists sarees whose code isn't in the house format (`WCS-001`, `WCS-002`…)
   or whose web address no longer matches their name.
2. Two tick-boxes decide what it does. **Giving products a house-format code**
   is on by default and is completely safe — a code is an internal reference
   nobody links to. **Shortening the web address** is off by default, because
   changing an address means any link you have already shared to the old one
   stops working.
3. **Preview changes** shows every old → new value before anything is saved.

Sarees marked **Storefront** (synced from the live site's own files) are never
listed here. Their web address is how the site matches their photos and words to
the public page, so moving it would blank the live page.

## Splitting mixed-colour photos into colour variants

When several colourways of one design arrive together — a WhatsApp batch of
mustard and pink of the same saree, say — they land as one variant with all the
photos in it. **"Split photos into colour variants"** on the Products page sorts
them out:

1. It lists sarees that have a single colour variant and more than one photo.
2. **Suggest a split** looks at the photos and proposes a colourway for each
   one. You see the actual thumbnails grouped under each colour name before
   anything happens.
3. Tick the ones that look right and **Split**.

No photo is ever uploaded or deleted — they're only moved between colours. Any
photo it can't confidently place, and every video, stays with the first
colourway. Afterwards you can rename a colour or drag a photo to a different one
in the normal product editor.

## Marking a color as sold out

You don't delete sold-out sarees. Instead:

1. Edit the product.
2. For the sold-out color variant, set **Status → Sold out**.
3. Save.

On the website, that color shows as crossed-out and can't be enquired about,
but other colors stay available — and the page stays live for Google.

## Managing inquiries

- Go to **Inquiries** to see everyone who submitted a form.
- Filter by **type** (retail / wholesale / general) or **source** (Instagram,
  Pinterest, etc.).
- Click a **phone number** to open WhatsApp and reply directly.

## WhatsApp subscribers

- Go to **Subscribers** to see everyone who signed up for updates.
- Filter by source.
- Click **Export CSV** to download the list (open it in Excel / Google Sheets)
  so you can broadcast new arrivals.

## Tips

- Always set a saree to **Published** when it's ready — Draft sarees are invisible to customers.
- Keep product codes consistent (e.g. `KAN-001`, `KAN-002`) — they make customer chats much easier.
- Sign out when using a shared computer (bottom of the sidebar).
