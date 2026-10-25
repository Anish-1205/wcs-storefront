import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";
import { SourceTracker } from "@/components/layout/SourceTracker";
import { CartProvider } from "@/lib/cart/CartContext";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartUndoToast } from "@/components/cart/CartUndoToast";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { PageContentProvider } from "@/components/content/ContentRegion";
import { getPageContent } from "@/lib/page-content-server";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageContentProvider initial={await getPageContent()}><AuthProvider>
      <CartProvider>
        <div className="storefront">
        {/* Keyboard users skip the navigation (T5.5); visible only when focused. */}
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-card focus:px-4 focus:py-2 focus:text-foreground focus:shadow">
          Skip to content
        </a>
        <SourceTracker />
        <Navbar />
        <main id="main" tabIndex={-1} className="min-h-[60vh] focus:outline-none">{children}</main>
        <Footer />
        <WhatsAppFloat />
        <CartDrawer />
        <CartUndoToast />
        </div>
      </CartProvider>
    </AuthProvider></PageContentProvider>
  );
}
