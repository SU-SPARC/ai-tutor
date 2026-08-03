import type { Metadata } from "next";

import "katex/dist/katex.min.css";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import { AccountActions } from "@/components/auth/account-actions";

export const metadata: Metadata = {
  title: "Suffolk AI Probability Tutor",
  description:
    "A rule-first probability and statistics tutor with professor review and controlled LLM fallback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const operatingMode = getOperatingModePolicy();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SiteHeader
            accountControl={<AccountActions />}
            environmentLabel={operatingMode.indicatorLabel}
          />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
