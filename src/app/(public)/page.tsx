import Link from "next/link";
import { getFeaturedProducts, getActiveCollections, getCategories } from "@/lib/queries";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { CollectionCard } from "@/components/collections/CollectionCard";
import { WhatsAppSubscribeForm } from "@/components/lead/WhatsAppSubscribeForm";
import { Button } from "@/components/ui/button";
import { buildWhatsAppURL } from "@/lib/whatsapp";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

export default async function HomePage() {
  const [featured, collections, categories] = await Promise.all([
    getFeaturedProducts(8),
    getActiveCollections(),
    getCategories(),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-secondary/60 to-ivory">
        <div className="container-px mx-auto flex max-w-7xl flex-col items-center py-20 text-center sm:py-28">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-dark">
            Direct from the loom
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-tight text-burgundy sm:text-6xl">
            Handwoven Sarees, Sourced Straight from India&apos;s Master Weavers
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            {SITE.description}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/catalog">
              <Button size="lg" className="w-full sm:w-auto">
                Explore the Collection
              </Button>
            </Link>
            <a href={buildWhatsAppURL()} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Enquire on WhatsApp
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container-px mx-auto max-w-7xl py-16">
        <div className="mb-8 text-center">
          <span className="gold-rule mx-auto" />
          <h2 className="mt-4 font-serif text-3xl text-burgundy">Shop by Weave</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {categories.slice(0, 10).map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      </section>

      {/* Featured products */}
      {featured.length > 0 && (
        <section className="container-px mx-auto max-w-7xl py-16">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <span className="gold-rule" />
              <h2 className="mt-4 font-serif text-3xl text-burgundy">
                Featured Sarees
              </h2>
            </div>
            <Link
              href="/catalog"
              className="text-sm font-medium text-burgundy hover:underline"
            >
              View all →
            </Link>
          </div>
          <ProductGrid products={featured} />
        </section>
      )}

      {/* Subscriber capture */}
      <section className="bg-secondary/40">
        <div className="container-px mx-auto grid max-w-7xl items-center gap-10 py-16 md:grid-cols-2">
          <div>
            <span className="gold-rule" />
            <h2 className="mt-4 font-serif text-3xl text-burgundy">
              New Arrivals on WhatsApp
            </h2>
            <p className="mt-3 max-w-md text-muted-foreground">
              Join our list and be the first to see fresh weaves, festive
              collections, and exclusive offers — delivered straight to your
              WhatsApp.
            </p>
          </div>
          <div className="max-w-md rounded-sm border border-border bg-white p-6">
            <WhatsAppSubscribeForm source="home" />
          </div>
        </div>
      </section>

      {/* Collections */}
      {collections.length > 0 && (
        <section className="container-px mx-auto max-w-7xl py-16">
          <div className="mb-8 text-center">
            <span className="gold-rule mx-auto" />
            <h2 className="mt-4 font-serif text-3xl text-burgundy">
              Curated Collections
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {collections.slice(0, 4).map((c) => (
              <CollectionCard key={c.id} collection={c} />
            ))}
          </div>
        </section>
      )}

      {/* Floating WhatsApp button on homepage */}
      <div className="fixed bottom-6 right-6 z-40">
        <a href={buildWhatsAppURL()} target="_blank" rel="noopener noreferrer">
          <Button size="lg" className="rounded-full px-5 shadow-lg">
            Chat on WhatsApp
          </Button>
        </a>
      </div>
    </>
  );
}
