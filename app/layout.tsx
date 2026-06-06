import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalRecorde",
  description: "Local multi-track recording with async sync",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
