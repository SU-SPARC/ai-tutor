import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import "katex/dist/katex.min.css";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { AccountActions } from "@/components/auth/account-actions";
import { getServerEnv } from "@/lib/env/server";
import { operatingModePolicyFor } from "@/lib/runtime/operating-mode";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Suffolk AI Probability Tutor",
  description:
    "A rule-first probability and statistics tutor with professor review and controlled LLM fallback.",
  // `icons` is intentionally omitted: Next derives the correct hashed URLs
  // from src/app/icon.png and src/app/apple-icon.png on its own.
  openGraph: {
    title: "Suffolk AI Probability Tutor",
    description:
      "A rule-first probability and statistics tutor with professor review and controlled LLM fallback.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const env = getServerEnv();
  const operatingMode = operatingModePolicyFor(env);
  const authenticationEnabled = env.CLERK_ENABLED;
  const application = (
    <ThemeProvider>
      <SiteHeader
        accountControl={<AccountActions />}
        environmentLabel={operatingMode.indicatorLabel}
      />
      {children}
    </ThemeProvider>
  );

  return (
    // `suppressHydrationWarning` is required because next-themes writes the
    // theme class onto <html> before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {authenticationEnabled ? (
          <ClerkProvider dynamic signInUrl="/sign-in" signUpUrl="/sign-up">
            {application}
          </ClerkProvider>
        ) : (
          application
        )}
      </body>
    </html>
  );
}
