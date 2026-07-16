"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { VariantManager } from "./VariantManager";
import { CollectionCheckboxes } from "./CollectionCheckboxes";
import { saveProduct } from "@/app/admin/actions";
import { slugify } from "@/lib/utils";
import type { Category, Collection } from "@/lib/supabase/types";
import type { ProductInputShape, VariantInputShape } from "@/lib/validation";

export type ProductFormInitial = Partial<ProductInputShape> & {
  variants: VariantInputShape[];
  collection_ids: string[];
};

interface Props {
  categories: Category[];
  collections: Pick<Collection, "id" | "name">[];
  initial?: ProductFormInitial;
}

export function ProductForm({ categories, collections, initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [fabric, setFabric] = useState(initial?.fabric_type ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [highlights, setHighlights] = useState(
    (initial?.highlights ?? []).join("\n"),
  );
  const [priceMin, setPriceMin] = useState<string>(
    initial?.base_price_min != null ? String(initial.base_price_min) : "",
  );
  const [priceMax, setPriceMax] = useState<string>(
    initial?.base_price_max != null ? String(initial.base_price_max) : "",
  );
  const [status, setStatus] = useState<ProductInputShape["status"]>(
    initial?.status ?? "draft",
  );
  const [productCode, setProductCode] = useState(initial?.product_code ?? "");
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [stockType, setStockType] = useState<ProductInputShape["stock_type"]>(
    initial?.stock_type ?? "supplier",
  );
  const [variants, setVariants] = useState<VariantInputShape[]>(initial?.variants ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    initial?.collection_ids ?? [],
  );

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Name is required.");
    if (variants.some((v) => !v.color.trim()))
      return setError("Every variant needs a color name.");

    setSaving(true);
    const payload: ProductInputShape = {
      id: initial?.id,
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      category_id: categoryId || null,
      fabric_type: fabric.trim() || null,
      description: description.trim() || null,
      highlights: highlights
        .split("\n")
        .map((h: string) => h.trim())
        .filter(Boolean),
      base_price_min: priceMin ? Number(priceMin) : null,
      base_price_max: priceMax ? Number(priceMax) : null,
      status,
      product_code: productCode.trim() || null,
      is_featured: isFeatured,
      stock_type: stockType,
      variants: variants.map((v, i) => ({ ...v, display_order: i })),
      collection_ids: collectionIds,
    };

    try {
      await saveProduct(payload);
      router.push("/admin/products");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save product.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Core fields */}
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Product details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="auto-generated"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Product code</Label>
            <Input
              id="code"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. GAD-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Select —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fabric">Fabric type</Label>
            <Input id="fabric" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="e.g. Pure Silk" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmin">Base price min (₹)</Label>
            <Input id="pmin" type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmax">Base price max (₹)</Label>
            <Input id="pmax" type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[140px]"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="highlights">Highlights (one per line)</Label>
            <Textarea
              id="highlights"
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder={"Pure silk pallu\nHandwoven\nMatching blouse piece"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as ProductInputShape["status"])}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock">Stock type</Label>
            <Select id="stock" value={stockType} onChange={(e) => setStockType(e.target.value as ProductInputShape["stock_type"])}>
              <option value="supplier">Supplier (sourced on order)</option>
              <option value="held">Held (in stock)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="h-4 w-4 accent-[#B8860B]"
            />
            Feature on homepage
          </label>
        </div>
      </section>

      {/* Variants */}
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">
          Color variants & images
        </h2>
        <VariantManager variants={variants} onChange={setVariants} />
      </section>

      {/* Collections */}
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Collections</h2>
        <CollectionCheckboxes
          collections={collections}
          selected={collectionIds}
          onChange={setCollectionIds}
        />
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save product"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/products")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
