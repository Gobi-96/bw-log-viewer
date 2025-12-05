import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BW Log Viewer",
  description: "Roaster log and roast session viewer for Bellwether units",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="page-shell">
        <header>
          <div className="inner">
            <div className="brand">
              <div className="brand-logo">
                <span>BW</span>
              </div>
              <div>
                <div className="brand-text-title">Roaster Log Viewer</div>
                <div className="brand-text-sub">
                  Discover roasts and alarms across your fleet
                </div>
              </div>
            </div>
            <div className="header-chip">
              <span>Backend:</span>
              <code>@google-cloud/logging</code>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}