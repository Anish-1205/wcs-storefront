import type { Product } from "@/data/products";
import type { ProductWithRelations } from "@/lib/supabase/types";
import { isVideoMedia } from "@/lib/variant-images";
import { cldVideoThumbnail } from "@/lib/cloudinary";

/** Preserve authored descriptions/roles while taking saved photos from admin. */
export function applyStorefrontMedia(products: Product[], rows: ProductWithRelations[]): Product[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return products.map((product) => {
    const row = bySlug.get(product.slug);
    if (!row) return product;
    const authored = product;
    product = {
      ...product,
      title: row.name ?? product.title,
      description: row.description ?? product.description,
      details: row.highlights ?? product.details,
      price: row.base_price_min === undefined ? product.price : row.base_price_min,
      featured: row.is_featured ?? product.featured,
    };
    const photos = [...(row.product_variants ?? [])]
      .sort((a, b) => a.display_order - b.display_order)
      .flatMap((variant) => [...(variant.variant_images ?? [])]
        .filter((image) => !isVideoMedia({ ...image, media_type: image.media_type ?? "image" }))
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order));
    const savedVideos = (row.product_variants ?? []).flatMap((variant) => variant.variant_images ?? [])
      .filter((image) => isVideoMedia({ ...image, media_type: image.media_type ?? "image" }));
    const videos = [...product.videos];
    for (const image of savedVideos) {
      if (!videos.some((video) => video.src === image.image_url)) videos.push({
        src: image.image_url, poster: cldVideoThumbnail(image.image_url), w: 1200, h: 1600, alt: `${product.title} in motion`,
      });
    }
    if (!photos.length) return savedVideos.length ? { ...product, videos } : row.name ? product : authored;
    const urls = [...new Set(photos.map((image) => image.image_url))];
    return {
      ...product,
      videos,
      primaryImageSrc: urls[0],
      images: urls.map((src) => product.images.find((image) => image.src === src) ?? {
        src, w: 1200, h: 1600, alt: product.title, role: "full" as const,
      }),
    };
  });
}
