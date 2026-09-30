"use client";

// Loaded only with `await import("./tour-driver")` from the tour provider, so
// driver.js and its stylesheet stay out of server bundles, node tests and the
// first page load. The theme overrides live at the end of globals.css.
import "driver.js/dist/driver.css";

export { driver } from "driver.js";
export type { Driver, PopoverDOM } from "driver.js";
