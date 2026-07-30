import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anima Studio",
  description:
    "Portable character generation workspace for ComfyUI Anima workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
