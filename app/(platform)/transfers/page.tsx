import { TransferHistory } from "@/components/data/TransferHistory";
import { getSessionFromCookies } from "@/lib/server/auth/request";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Transfer History",
};

export default async function TransfersPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect("/login");
  if (user.role === "team_lead") redirect("/");

  return <TransferHistory />;
}
