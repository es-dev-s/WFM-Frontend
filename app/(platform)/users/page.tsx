import { UsersDirectory } from "@/components/data/UsersDirectory";
import { getSessionFromCookies } from "@/lib/server/auth/request";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  const user = await getSessionFromCookies();
  if (!user) redirect("/login");
  if (user.role !== "wfm") redirect("/");

  return <UsersDirectory />;
}
