import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tivazo",
};

export default function TivazoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
