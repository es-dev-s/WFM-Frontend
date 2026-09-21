import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Biometrics",
};

export default function BiomaticLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
