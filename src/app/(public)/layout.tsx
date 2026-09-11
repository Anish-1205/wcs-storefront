import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";
import { SourceTracker } from "@/components/layout/SourceTracker";
import { CartProvider } from "@/lib/cart/CartContext";
import { CartDrawer } from "@/components/cart/CartDrawer";
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
        <SourceTracker />
        <Navbar />
        <main className="min-h-[60vh]">{children}</main>
        <Footer />
        <WhatsAppFloat />
        <CartDrawer />
        </div>
      </CartProvider>
    </AuthProvider></PageContentProvider>
  );
}
