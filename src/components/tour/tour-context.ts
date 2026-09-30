"use client";

import { createContext, useContext } from "react";

import type { TourRole } from "@/components/tour/tour-steps";

export type TourContextValue = {
  role: TourRole;
  /** Start the onboarding guide now, ignoring the seen flag. */
  start: () => void;
};

export const TourContext = createContext<TourContextValue | null>(null);

/** The onboarding guide, or null for signed-out visitors (no tour). */
export function useTour() {
  return useContext(TourContext);
}
