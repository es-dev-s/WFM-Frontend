import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { getSessionFromCookies } from "@/lib/server/auth/request";
import { isScopedAuthRole } from "@/lib/auth-role";
import { publicUser } from "@/lib/server/auth/types";
import { runWithAuth } from "@/lib/server/auth/context";
import { relabelAssignments } from "@/lib/server/auth/scope";
import { filters } from "@/lib/server/bff";
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
  const user = await getSessionFromCookies();
  if (!user) redirect("/login");

  const jar = await cookies();
  const initialCollapsed = parseSidebarCookie(jar.get(SIDEBAR_COOKIE)?.value);
  let session = publicUser(user);
  if (isScopedAuthRole(user.role) && user.assignments.length) {
    session = await runWithAuth(user, async () => {
      const options = await filters(new URL("http://local/filters"));
      return publicUser({
        ...user,
        assignments: relabelAssignments(
          user.assignments,
          options.supervisors,
          options.teams,
        ),
      });
    });
  }

  return (
    <SessionProvider user={session}>
      <AppShell initialCollapsed={initialCollapsed}>{children}</AppShell>
    </SessionProvider>
  );
}
