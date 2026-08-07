import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

import "katex/dist/katex.min.css";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { AccountActions } from "@/components/auth/account-actions";
import { getServerEnv } from "@/lib/env/server";
import { operatingModePolicyFor } from "@/lib/runtime/operating-mode";

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
    <html lang="en" className="dark" suppressHydrationWarning>
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
