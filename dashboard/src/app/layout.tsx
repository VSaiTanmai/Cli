import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "CLIF — Cognitive Log Investigation Framework",
  description: "Enterprise security operations and log investigation platform",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans`}>
        <Sidebar />
        <div className="pl-60 transition-all duration-200">
          <TopBar />
          <main className="min-h-[calc(100vh-3.5rem)] p-6">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            duration: 5000,
            className: "text-sm",
          }}
        />
      </body>
    </html>
  );
}
