import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/AppShell";
import {
  parseSidebarCookie,
  SIDEBAR_COOKIE,
} from "@/lib/sidebar-preference";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const initialCollapsed = parseSidebarCookie(jar.get(SIDEBAR_COOKIE)?.value);

  return (
    <AppShell initialCollapsed={initialCollapsed}>{children}</AppShell>
  );
}
