import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getSessionFromCookies } from "@/lib/server/auth/request";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionFromCookies();
  if (user) {
    const params = await searchParams;
    const next = params.next && params.next.startsWith("/") ? params.next : "/";
    redirect(next);
  }

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
