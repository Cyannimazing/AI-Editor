import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CapCut Automation",
  description: "Local workspace for reusable, editable video effects.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
