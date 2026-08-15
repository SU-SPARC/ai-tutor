"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import * as React from "react";

import { useIsHydrated } from "@/lib/use-is-hydrated";

/**
 * Clerk renders its own widget styles and cannot read our CSS custom
 * properties, so the palette is mirrored here as literals. These values are
 * the same tokens defined in `globals.css` — keep the two in sync.
 */
const LIGHT = {
  colorPrimary: "#0048D0",
  colorBackground: "#FFFFFF",
  colorText: "#0E131D",
  colorTextSecondary: "#5A626E",
  colorInputBackground: "#FFFFFF",
  colorInputText: "#0E131D",
  colorDanger: "#D40C1A",
  colorSuccess: "#008048",
  colorWarning: "#955900",
};

const DARK = {
  colorPrimary: "#5999F8",
  colorBackground: "#141920",
  colorText: "#EFF3F6",
  colorTextSecondary: "#9DA7B4",
  colorInputBackground: "#0B0F14",
  colorInputText: "#EFF3F6",
  colorDanger: "#F75D59",
  colorSuccess: "#0FD18B",
  colorWarning: "#F9B73F",
};

function useClerkAppearance() {
  const { resolvedTheme } = useTheme();
  const hydrated = useIsHydrated();

  // Before hydration the resolved theme is unknown; default to dark, which is
  // this app's default theme, so the first paint matches in the common case.
  const palette = !hydrated || resolvedTheme === "dark" ? DARK : LIGHT;

  return {
    variables: {
      ...palette,
      borderRadius: "0.625rem",
      fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
    },
    elements: {
      card: "shadow-sm border border-border",
      headerTitle: "tracking-tight",
      formButtonPrimary: "shadow-sm normal-case",
    },
  };
}

export function ThemedSignIn(props: React.ComponentProps<typeof SignIn>) {
  const appearance = useClerkAppearance();
  return <SignIn appearance={appearance} {...props} />;
}

export function ThemedSignUp(props: React.ComponentProps<typeof SignUp>) {
  const appearance = useClerkAppearance();
  return <SignUp appearance={appearance} {...props} />;
}
