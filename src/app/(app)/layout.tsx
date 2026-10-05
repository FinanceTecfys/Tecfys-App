import { Sidebar } from "@/components/layout/sidebar";
import { requireUser } from "@/lib/supabase/auth";

// Every screen reads live data from Supabase: never prerender at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // The proxy already gates every request; this is the in-app second check.
  // Each page then asks for its own capability (requireRole).
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={user.email} role={user.role} />
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
