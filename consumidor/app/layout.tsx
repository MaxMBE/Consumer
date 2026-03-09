import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wolvex Platform - Pepsi Cupones",
  description: "Gestión de campañas de cupones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
