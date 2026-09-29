"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import * as React from "react";

/**
 * Clerk renders its own widget styles and cannot read our CSS custom
 * properties (it computes shades from plain colour strings), so the palette
 * is resolved from the live tokens in `globals.css` at runtime: each token is
 * painted into a 1px canvas and read back as rgb(). It re-resolves whenever
 * the theme class on <html> changes, so there is no hand-copied palette to
 * drift.
 */
const TOKENS = {
  colorPrimary: "--azure-500",
  colorBackground: "--sheet",
  colorText: "--ink",
  colorTextSecondary: "--ink-muted",
  colorInputBackground: "--sheet",
  colorInputText: "--ink",
  colorDanger: "--red-500",
  colorSuccess: "--green-500",
  colorWarning: "--amber-500",
  colorNeutral: "--ink",
} as const;

type Palette = Record<keyof typeof TOKENS, string>;

let cachedKey: string | null = null;
let cachedPalette: Palette | null = null;

function resolvePalette(): Palette | null {
  if (typeof document === "undefined") {
    return null;
  }
  const key = document.documentElement.className;
  if (key === cachedKey && cachedPalette) {
    return cachedPalette;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const palette = {} as Palette;
  for (const [variable, token] of Object.entries(TOKENS) as [
    keyof typeof TOKENS,
    string,
  ][]) {
    probe.style.color = `var(${token})`;
    const computed = getComputedStyle(probe).color;
    if (!context) {
      palette[variable] = computed;
      continue;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    palette[variable] = `rgb(${red}, ${green}, ${blue})`;
  }
  probe.remove();
  cachedKey = key;
  cachedPalette = palette;
  return palette;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function useClerkAppearance() {
  const palette = React.useSyncExternalStore(subscribe, resolvePalette, () => null);

  return {
    variables: {
      ...(palette ?? {}),
      borderRadius: "0.375rem",
      fontFamily: "var(--font-sans)",
      fontSize: "1rem",
    },
    elements: {
      card: "bg-sheet sheet-shadow",
      headerTitle: "type-h2",
      formButtonPrimary: "normal-case",
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

