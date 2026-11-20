import { OffboardingManager } from "@/components/data/OffboardingManager";
import { getSessionFromCookies } from "@/lib/server/auth/request";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Offboarding",
};

export default async function OffboardingPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect("/login");
  if (user.role === "team_lead") redirect("/");

  return <OffboardingManager />;
}
