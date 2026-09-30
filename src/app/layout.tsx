import type { Metadata, Viewport } from "next";
import { Source_Code_Pro, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import "katex/dist/katex.min.css";
import "./globals.css";
import { CoursesStoreProvider } from "@/components/courses/courses-store";
import { AppHeader, type AppHeaderRole } from "@/components/shell/app-header";
import { SkipLink } from "@/components/shell/skip-link";
import { ThemeProvider } from "@/components/theme-provider";
import { AccountActions } from "@/components/auth/account-actions";
import { TourProvider } from "@/components/tour/tour-provider";
import { Toaster } from "@/components/ui/toast";
import {
  currentAuthenticatedUser,
  hasPermission,
} from "@/lib/auth/authorization";
import { getSelectedCourse } from "@/lib/course-selection";
import { getServerEnv } from "@/lib/env/server";
import { operatingModePolicyFor } from "@/lib/runtime/operating-mode";

// One superfamily, designed together. The serif carries titles and problem
// statements (the optical-size axis keeps 17px text sturdy and 48px titles
// fine); the sans carries the interface; the mono carries answers and codes.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal"],
  variable: "--font-source-serif",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
  display: "swap",
});

const sourceCode = Source_Code_Pro({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-source-code",
  display: "swap",
});

const DESCRIPTION =
  "Practice MATH-255 probability and statistics problems. Hints before answers, and every question approved by your professor.";

// Pages set a short name ("Learn", "Review queue"); the template adds the
// product after a middle dot. Pages that set no title (the landing page)
// get the default.
export const metadata: Metadata = {
  title: { default: "ProbStat Tutor", template: "%s · ProbStat Tutor" },
  description: DESCRIPTION,
  applicationName: "ProbStat Tutor",
  // `icons` is intentionally omitted: Next derives the hashed URLs from
  // src/app/icon.svg, icon.png and apple-icon.png on its own.
  openGraph: {
    title: "ProbStat Tutor",
    description: DESCRIPTION,
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // --surface in each theme, as hex because browser chrome needs a plain colour.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f18" },
  ],
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

/**
 * The course the visitor is working in, for the header chip. A failure to read
 * it falls back to no chip detail rather than failing the page.
 */
async function resolveHeaderCourse() {
  try {
    const { course } = await getSelectedCourse();
    return { id: course.id, title: course.title };
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
  const [role, headerCourse] = await Promise.all([
    resolveHeaderRole(),
    resolveHeaderCourse(),
  ]);
  // The onboarding guide gets the same server-resolved role; signed-out
  // visitors (no role) never see a tour.
  const shell = (
    <TourProvider role={role ?? null}>
      <SkipLink />
      <AppHeader
        accountControl={
          <AccountActions environmentLabel={operatingMode.indicatorLabel} />
        }
        environmentLabel={operatingMode.indicatorLabel}
        role={role}
        course={headerCourse}
      />
      {children}
      <Toaster />
    </TourProvider>
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
      className={`${sourceSerif.variable} ${sourceSans.variable} ${sourceCode.variable}`}
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
