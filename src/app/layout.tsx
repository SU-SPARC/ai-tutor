import type { Metadata } from "next"

import "katex/dist/katex.min.css"
import "./globals.css"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@/components/theme-provider"
import { getDataRepositoryMetadata } from "@/lib/data/data-store"
import { getServerEnv } from "@/lib/env/server"

export const metadata: Metadata = {
  title: "Suffolk AI Probability Tutor",
  description:
    "A rule-first probability and statistics tutor with professor review and controlled LLM fallback.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const env = getServerEnv()
  const demoMode =
    getDataRepositoryMetadata().mode === "demo" || !env.AI_ENABLED

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SiteHeader demoMode={demoMode} />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
