"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveCollection } from "@/app/admin/actions";
import type { Product } from "@/lib/supabase/types";
import type { CollectionInputShape } from "@/lib/validation";

export interface CollectionFormInitial extends Partial<CollectionInputShape> {
  product_ids: string[];
}

interface Props {
  products: Pick<Product, "id" | "name" | "slug">[];
  initial?: CollectionFormInitial;
}

export function CollectionForm({ products, initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [displayOrder, setDisplayOrder] = useState(String(initial?.display_order ?? 0));
  const [productIds, setProductIds] = useState<string[]>(initial?.product_ids ?? []);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  }

  function toggleProduct(id: string) {
    setProductIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function moveProduct(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= productIds.length) return;
    const next = [...productIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setProductIds(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required.");

    setSaving(true);
    try {
      await saveCollection({
        id: initial?.id,
        name: name.trim(),
        slug: slug.trim() || null,
        description: description.trim() || null,
        image_url: imageUrl.trim() || null,
        is_active: isActive,
        display_order: Number(displayOrder) || 0,
        product_ids: productIds,
      });
      router.push("/admin/collections");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save collection.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Collection details</h2>
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
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="order">Display order</Label>
            <Input id="order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="image_url">Image URL</Label>
            <Input id="image_url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Cloudinary or image URL" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[140px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="active">Status</Label>
            <Select id="active" value={isActive ? "true" : "false"} onChange={(e) => setIsActive(e.target.value === "true") }>
              <option value="true">Active</option>
              <option value="false">Hidden</option>
            </Select>
          </div>
        </div>
      </section>

      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Collection membership</h2>
        {productIds.length > 0 && (
          <div className="mb-4 space-y-2 rounded-sm border border-border bg-secondary/20 p-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Current order</p>
            <div className="space-y-2">
              {productIds.map((productId, index) => {
                const product = products.find((item) => item.id === productId);
                return (
                  <div key={productId} className="flex items-center justify-between gap-3 rounded-sm bg-white px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-foreground">{product?.name ?? productId}</span>
                      {product?.slug && <span className="ml-2 text-muted-foreground">({product.slug})</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <button type="button" onClick={() => moveProduct(index, -1)} className="px-1" aria-label="Move product up">↑</button>
                      <button type="button" onClick={() => moveProduct(index, 1)} className="px-1" aria-label="Move product down">↓</button>
                      <button type="button" onClick={() => toggleProduct(productId)} className="text-destructive hover:underline">Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products available yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((product) => (
              <label key={product.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={productIds.includes(product.id)}
                  onChange={() => toggleProduct(product.id)}
                  className="h-4 w-4 accent-[#B8860B]"
                />
                <span>{product.name}</span>
                <span className="text-muted-foreground">({product.slug})</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save collection"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/collections")}>Cancel</Button>
      </div>
    </form>
  );
}
