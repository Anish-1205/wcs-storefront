"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  if (iconOnly) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="mx-auto flex"
        onClick={handleSignOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
