import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import "katex/dist/katex.min.css";
import "./globals.css";
import { CoursesStoreProvider } from "@/components/courses/courses-store";
import { AppHeader, type AppHeaderRole } from "@/components/shell/app-header";
import { ThemeProvider } from "@/components/theme-provider";
import { AccountActions } from "@/components/auth/account-actions";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";
import { getServerEnv } from "@/lib/env/server";
import { operatingModePolicyFor } from "@/lib/runtime/operating-mode";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// The display serif. Italic is loaded because the landing hero uses exactly
// one italic line; nothing else in the app does.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

// Question codes, answer inputs, week labels — anything that is a value rather
// than a sentence.
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
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

/**
 * The header needs to know which of the two navs to render. Resolving it here
 * keeps the header a server component; a failure to reach identity storage
 * must not take the whole page down, so it degrades to the signed-out nav —
 * the same rule `AccountActions` already follows.
 */
async function resolveHeaderRole(): Promise<AppHeaderRole | undefined> {
  try {
    const principal = await currentAuthenticatedUser();
    if (!principal) {
      return undefined;
    }
    return hasPermission(principal, "professor") ? "professor" : "student";
  } catch {
    return undefined;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const env = getServerEnv();
  const operatingMode = operatingModePolicyFor(env);
  const authenticationEnabled = env.CLERK_ENABLED;
  const role = await resolveHeaderRole();
  const shell = (
    <>
      <AppHeader
        accountControl={<AccountActions />}
        environmentLabel={operatingMode.indicatorLabel}
        role={role}
      />
      {children}
    </>
  );
  // Professors get the courses store above the header so its course switcher
  // is live on every page, not only under /professor.
  const application = (
    <ThemeProvider>
      {role === "professor" ? (
        <CoursesStoreProvider>{shell}</CoursesStoreProvider>
      ) : (
        shell
      )}
    </ThemeProvider>
  );

  return (
    // `suppressHydrationWarning` is required because next-themes writes the
    // theme class onto <html> before React hydrates.
    <html
      lang="en"
      className={`${inter.variable} ${newsreader.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
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
