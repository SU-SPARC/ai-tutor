"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Alignment, Driver, PopoverDOM, Side } from "driver.js";

import { buttonVariants } from "@/components/ui/button";
import {
  TourContext,
  type TourContextValue,
} from "@/components/tour/tour-context";
import {
  anchorSelector,
  clampPopover,
  stepLabel,
  stepMatchesPath,
  stepsForRole,
  shouldAutoStart,
  TOUR_BUTTONS,
  TOUR_EVENT,
  TOUR_HOME,
  TOUR_QUERY_PARAM,
  TOUR_SESSION_KEY,
  TOUR_WELCOME,
  tourStorageKey,
  type TourRole,
  type TourStep,
} from "@/components/tour/tour-steps";
import { cn } from "@/lib/utils";

/** How long a home page gets to settle before the first-visit tour. */
const AUTO_START_DELAY_MS = 800;
/** How long to wait for a step's element after a page change. */
const ANCHOR_WAIT_MS = 3000;
const ANCHOR_POLL_MS = 100;
/** A saved cross-page position older than this is ignored. */
const RESUME_MAX_AGE_MS = 60_000;
/** Phones: the card docks as a sheet instead of floating (see globals.css). */
const PHONE_QUERY = "(max-width: 639.98px)";
const WELCOME = -1;

/** Attributes driver.js overwrites on the lit element; restored afterwards. */
const BORROWED_ATTRIBUTES = [
  "aria-haspopup",
  "aria-expanded",
  "aria-controls",
] as const;

type PendingHop = {
  role: TourRole;
  stepIndex: number;
  direction: 1 | -1;
  at: number;
};

type EndReason = "done" | "skip" | "escape" | "not-now" | "left-page";

const buttonClass = (variant: "secondary" | "outline" | "ghost") =>
  cn(buttonVariants({ variant, size: "md" }), "min-h-11 probstat-tour-button");

function readSeen(role: TourRole) {
  try {
    return window.localStorage.getItem(tourStorageKey(role)) === "seen";
  } catch {
    // Storage blocked: behave as if seen, so the tour never nags.
    return true;
  }
}

function writeSeen(role: TourRole) {
  try {
    window.localStorage.setItem(tourStorageKey(role), "seen");
  } catch {
    // Nothing to do; the menu item still opens the guide.
  }
}

function readPendingHop(): PendingHop | undefined {
  try {
    const raw = window.sessionStorage.getItem(TOUR_SESSION_KEY);
    if (!raw) {
      return undefined;
    }
    const value = JSON.parse(raw) as Partial<PendingHop>;
    if (
      (value.role === "professor" || value.role === "student") &&
      typeof value.stepIndex === "number" &&
      typeof value.at === "number"
    ) {
      return {
        role: value.role,
        stepIndex: value.stepIndex,
        direction: value.direction === -1 ? -1 : 1,
        at: value.at,
      };
    }
  } catch {
    // Unreadable: treat as no pending step.
  }
  return undefined;
}

function writePendingHop(value: PendingHop | undefined) {
  try {
    if (value) {
      window.sessionStorage.setItem(TOUR_SESSION_KEY, JSON.stringify(value));
    } else {
      window.sessionStorage.removeItem(TOUR_SESSION_KEY);
    }
  } catch {
    // The tour simply won't resume after the page change.
  }
}

function isVisible(element: Element) {
  return element.getClientRects().length > 0;
}

/** The first visible element for the step's anchor, then its fallback. */
function resolveStepElement(step: TourStep): Element | undefined {
  for (const id of [step.anchor, step.fallback]) {
    if (!id) {
      continue;
    }
    for (const element of document.querySelectorAll(anchorSelector(id))) {
      if (isVisible(element)) {
        return element;
      }
    }
  }
  return undefined;
}

function placementFor(element: Element): { side: Side; align: Alignment } {
  const id = element.getAttribute("data-tour") ?? "";
  if (element.getAttribute("data-slot") === "drawer-edge-tab") {
    // The rotated tab is fixed to the right edge: the card goes beside it.
    return { side: "left", align: "center" };
  }
  if (id.startsWith("rail-")) {
    return { side: "right", align: "start" };
  }
  if (id === "account-menu" || id === "professor-menu") {
    return { side: "bottom", align: "end" };
  }
  return { side: "bottom", align: "start" };
}

/** Fixed-position elements (or inside one) are always on screen. */
function isFixed(element: Element) {
  for (
    let node: Element | null = element;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (window.getComputedStyle(node).position === "fixed") {
      return true;
    }
  }
  return false;
}

const DRIVER_CLASSES = ["driver-active-element", "driver-no-interaction"];
const DRIVER_PARENT_CLASSES = [
  "driver-active-element-parent",
  "driver-active-element-parent-no-scroll",
];

/**
 * Keep the card inside the window (8px from each edge). driver.js can place
 * it off-screen next to edge-hugging targets. Phones dock it with CSS.
 */
function clampCard() {
  const wrapper = document.querySelector<HTMLElement>(
    ".driver-popover.probstat-tour",
  );
  if (!wrapper || window.matchMedia(PHONE_QUERY).matches) {
    return;
  }
  const rect = wrapper.getBoundingClientRect();
  const { left, top } = clampPopover(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  if (Math.abs(left - rect.left) < 0.5 && Math.abs(top - rect.top) < 0.5) {
    return;
  }
  wrapper.style.left = `${left}px`;
  wrapper.style.top = `${top}px`;
  wrapper.style.right = "auto";
  wrapper.style.bottom = "auto";
  // The arrow no longer points at the target once the card has moved.
  wrapper
    .querySelector(".driver-popover-arrow")
    ?.classList.add("driver-popover-arrow-none");
}

/** Two frames: after driver.js has positioned the card for this change. */
function afterDriverPaint(callback: () => void) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Resolves once `find` returns an element, or with undefined after `ms`. */
function waitFor<T>(
  find: () => T | undefined,
  ms: number,
  signal: AbortSignal,
) {
  return new Promise<T | undefined>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (signal.aborted) {
        resolve(undefined);
        return;
      }
      const found = find();
      if (found !== undefined || Date.now() - started >= ms) {
        resolve(found);
        return;
      }
      window.setTimeout(tick, ANCHOR_POLL_MS);
    };
    tick();
  });
}

function closeAccountMenu() {
  const trigger = document.querySelector<HTMLButtonElement>(
    `${anchorSelector("account-menu")}[aria-expanded="true"]`,
  );
  trigger?.click();
}

/**
 * The onboarding guide. Mounted once in the root layout with the role the
 * server resolved; renders nothing extra for signed-out visitors.
 *
 * - First visit: once per role, on the role's home page (/professor, /learn),
 *   after the page settles and only when the first step's element exists.
 * - `?guide=1` on any page starts it at step 1 and strips the parameter.
 * - `start()` (context) or `window` event `probstat:start-guide` starts it
 *   from anywhere; away from the home page it goes home first.
 * - The student tour hops from /learn to the Continue card's question: the
 *   position is kept in sessionStorage and resumed when the element appears.
 *
 * driver.js is imported on demand, so SSR and node tests never load it.
 */
export function TourProvider({
  role,
  children,
}: {
  role: TourRole | null;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const pathnameRef = useRef(pathname);
  const driverRef = useRef<Driver | null>(null);
  const currentRef = useRef<number | null>(null);
  const hoppingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Original aria attributes of every element the tour has lit.
  const borrowedRef = useRef(new Map<Element, (string | null)[]>());
  const viewportListenerRef = useRef<(() => void) | null>(null);
  const keyListenerRef = useRef<((event: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const steps = useMemo(() => (role ? stepsForRole(role) : []), [role]);

  // ---- driver.js plumbing ------------------------------------------------

  /**
   * Put back the aria attributes driver.js overwrote, and strip its classes,
   * on every element except `keep` (the one lit now).
   */
  const releaseElements = useCallback((keep?: Element) => {
    const borrowed = borrowedRef.current;
    for (const [element, values] of borrowed) {
      if (element === keep) {
        continue;
      }
      BORROWED_ATTRIBUTES.forEach((name, index) => {
        const value = values[index];
        if (value === null) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, value);
        }
      });
      borrowed.delete(element);
    }
    document.querySelectorAll(".driver-active-element").forEach((element) => {
      if (element !== keep) {
        element.classList.remove(...DRIVER_CLASSES);
      }
    });
    document
      .querySelectorAll(".driver-active-element-parent")
      .forEach((parent) => {
        if (!keep || parent !== keep.parentElement) {
          parent.classList.remove(...DRIVER_PARENT_CLASSES);
        }
      });
  }, []);

  const teardown = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (keyListenerRef.current) {
      window.removeEventListener("keydown", keyListenerRef.current, true);
      keyListenerRef.current = null;
    }
    if (viewportListenerRef.current) {
      window.removeEventListener("resize", viewportListenerRef.current);
      window.removeEventListener("scroll", viewportListenerRef.current);
      viewportListenerRef.current = null;
    }
    const instance = driverRef.current;
    driverRef.current = null;
    currentRef.current = null;
    if (instance?.isActive()) {
      instance.destroy();
    }
    releaseElements();
  }, [releaseElements]);

  // Unmount (sign-out re-renders the layout without a role).
  useEffect(() => teardown, [teardown]);

  const finish = useCallback(
    (reason: EndReason) => {
      if (!role) {
        return;
      }
      writeSeen(role);
      writePendingHop(undefined);
      hoppingRef.current = false;
      teardown();
      if (reason === "done" || reason === "skip" || reason === "not-now") {
        const trigger = document.querySelector<HTMLElement>(
          anchorSelector("account-menu"),
        );
        if (trigger && isVisible(trigger)) {
          trigger.focus({ preventScroll: true });
        }
      }
    },
    [role, teardown],
  );

  // `show` and `hop` call each other; a ref breaks the cycle for the hooks.
  const showRef = useRef<(index: number, direction: 1 | -1) => void>(() => {});

  const hop = useCallback(
    (index: number, direction: 1 | -1) => {
      if (!role) {
        return;
      }
      const step = steps[index];
      let href = TOUR_HOME[role];
      if (step.page === "practice") {
        const links = Array.from(
          document.querySelectorAll<HTMLAnchorElement>(
            `${anchorSelector("learn-continue")} a[href]`,
          ),
        );
        const practice = links.find((link) =>
          link.getAttribute("href")?.startsWith("/practice"),
        );
        href = practice?.getAttribute("href") ?? "/practice";
      }
      writePendingHop({ role, stepIndex: index, direction, at: Date.now() });
      hoppingRef.current = true;
      teardown();
      router.push(href);
    },
    [role, router, steps, teardown],
  );

  const renderCard = useCallback(
    (popover: PopoverDOM, index: number) => {
      const { wrapper, title, footer } = popover;
      // driver.js sets role="dialog", aria-labelledby and aria-describedby;
      // it does not mark the dialog modal.
      wrapper.setAttribute("aria-modal", "true");
      // The card is position: fixed; letting driver.js scroll it "into
      // view" only jumps the page (and it is clamped on screen below).
      wrapper.scrollIntoView = () => {};

      wrapper.querySelector(".probstat-tour-step")?.remove();
      wrapper.querySelector(".probstat-tour-actions")?.remove();

      if (index !== WELCOME) {
        const counter = document.createElement("p");
        counter.className = "probstat-tour-step";
        counter.setAttribute("aria-live", "polite");
        counter.textContent = stepLabel(index, steps.length);
        wrapper.insertBefore(counter, title);
      }

      const actions = document.createElement("div");
      actions.className = "probstat-tour-actions";
      const button = (
        label: string,
        variant: "secondary" | "outline" | "ghost",
        onClick: () => void,
      ) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = buttonClass(variant);
        element.textContent = label;
        element.addEventListener("click", onClick);
        actions.appendChild(element);
        return element;
      };

      let primary: HTMLButtonElement;
      if (index === WELCOME) {
        const [notNow, takeTour] = TOUR_WELCOME.buttons;
        button(notNow, "outline", () => finish("not-now"));
        primary = button(takeTour, "secondary", () => showRef.current(0, 1));
      } else {
        const skip = button(TOUR_BUTTONS.skip, "ghost", () => finish("skip"));
        skip.classList.add("probstat-tour-skip");
        if (index > 0) {
          button(TOUR_BUTTONS.back, "outline", () =>
            showRef.current(index - 1, -1),
          );
        }
        const last = index === steps.length - 1;
        primary = button(
          last ? TOUR_BUTTONS.done : TOUR_BUTTONS.next,
          "secondary",
          () => (last ? finish("done") : showRef.current(index + 1, 1)),
        );
      }
      footer.after(actions);

      // driver.js focuses the first button after this hook; move focus to
      // the forward action, and dock the phone sheet away from the target.
      window.requestAnimationFrame(() => {
        if (wrapper.isConnected) {
          primary.focus({ preventScroll: true });
        }
        const target = document.querySelector(".driver-active-element");
        const phone = window.matchMedia(PHONE_QUERY).matches;
        const low =
          target && target.id !== "driver-dummy-element"
            ? target.getBoundingClientRect().bottom > window.innerHeight * 0.55
            : false;
        wrapper.classList.toggle("probstat-tour-top", phone && low);
      });
      afterDriverPaint(clampCard);
    },
    [finish, steps.length],
  );

  const highlight = useCallback(
    (index: number, element: Element | undefined) => {
      const instance = driverRef.current;
      if (!instance) {
        return;
      }
      // driver.js overwrites aria-haspopup/expanded/controls on the element
      // it lights. Snapshot the originals once per element.
      if (element && !borrowedRef.current.has(element)) {
        borrowedRef.current.set(
          element,
          BORROWED_ATTRIBUTES.map((name) => element.getAttribute(name)),
        );
      }
      // A fixed element is always on screen; scrolling to it only jumps the
      // page. Shadow scrollIntoView for this synchronous highlight call.
      const pinned = element && isFixed(element) ? element : undefined;
      if (pinned) {
        pinned.scrollIntoView = () => {};
      }
      const copy =
        index === WELCOME
          ? { title: TOUR_WELCOME.headline, description: TOUR_WELCOME.sentence }
          : {
              title: steps[index].headline,
              description: steps[index].sentence,
            };
      currentRef.current = index;
      instance.highlight({
        element,
        popover: {
          ...copy,
          ...(element ? placementFor(element) : {}),
          showButtons: [],
          showProgress: false,
          onPopoverRender: (popover) => renderCard(popover, index),
        },
      });
      if (pinned) {
        Reflect.deleteProperty(pinned, "scrollIntoView");
      }
      // driver.js only cleans the element it last finished animating to, so
      // a quick Next can leave an older target lit: clean everything else.
      releaseElements(
        element ?? document.getElementById("driver-dummy-element") ?? undefined,
      );
    },
    [releaseElements, renderCard, steps],
  );

  const show = useCallback(
    (index: number, direction: 1 | -1) => {
      if (!role || !driverRef.current) {
        return;
      }
      if (index === WELCOME) {
        highlight(WELCOME, undefined);
        return;
      }
      // Walk in `direction` past steps whose element (and fallback) is
      // missing; "Step n of 6" keeps each step's own number.
      for (let next = index; ; next += direction) {
        if (next < 0) {
          // Nothing earlier to show; stay on the current card.
          return;
        }
        if (next >= steps.length) {
          finish("done");
          return;
        }
        const step = steps[next];
        if (!stepMatchesPath(step, role, pathnameRef.current)) {
          hop(next, direction);
          return;
        }
        const element = resolveStepElement(step);
        if (element) {
          highlight(next, element);
          return;
        }
      }
    },
    [finish, highlight, hop, role, steps],
  );

  useEffect(() => {
    showRef.current = show;
  }, [show]);

  /** Load driver.js (once) and open a driver for this page. */
  const openDriver = useCallback(async () => {
    const { driver } = await import("@/components/tour/tour-driver");
    if (driverRef.current) {
      return driverRef.current;
    }
    const reduced = prefersReducedMotion();
    const instance = driver({
      animate: !reduced,
      smoothScroll: !reduced,
      // Escape ends the tour; clicks on the dimmed page do nothing.
      allowClose: true,
      overlayClickBehavior: () => {},
      allowKeyboardControl: true,
      disableActiveInteraction: true,
      showButtons: [],
      showProgress: false,
      stagePadding: 6,
      stageRadius: 10,
      overlayColor: "oklch(0.14 0.02 262)",
      overlayOpacity: 0.55,
      popoverClass: "probstat-tour",
      onDestroyStarted: () => finish("escape"),
    });
    driverRef.current = instance;

    const onKeyDown = (event: KeyboardEvent) => {
      const index = currentRef.current;
      if (index === null || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        if (index === WELCOME) {
          showRef.current(0, 1);
        } else if (index === steps.length - 1) {
          finish("done");
        } else {
          showRef.current(index + 1, 1);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        if (index > 0) {
          showRef.current(index - 1, -1);
        }
      }
    };
    keyListenerRef.current = onKeyDown;
    window.addEventListener("keydown", onKeyDown, true);
    // driver.js repositions the card on resize and scroll; clamp after it.
    const onViewportChange = () => afterDriverPaint(clampCard);
    viewportListenerRef.current = onViewportChange;
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, { passive: true });
    return instance;
  }, [finish, steps.length]);

  /**
   * Start at `index` (WELCOME for the first-visit card) on this page, waiting
   * up to 3 s for the step's element when `wait` is set.
   */
  const begin = useCallback(
    async (index: number, direction: 1 | -1, wait: boolean) => {
      if (!role) {
        return;
      }
      teardown();
      const controller = new AbortController();
      abortRef.current = controller;
      if (wait && index >= 0 && index < steps.length) {
        await waitFor(
          () => resolveStepElement(steps[index]),
          ANCHOR_WAIT_MS,
          controller.signal,
        );
      }
      if (controller.signal.aborted) {
        return;
      }
      await openDriver();
      if (controller.signal.aborted) {
        teardown();
        return;
      }
      showRef.current(index, direction);
    },
    [openDriver, role, steps, teardown],
  );

  // ---- entry points ------------------------------------------------------

  const start = useCallback(() => {
    if (!role) {
      return;
    }
    closeAccountMenu();
    writePendingHop(undefined);
    if (pathnameRef.current === TOUR_HOME[role]) {
      void begin(0, 1, true);
    } else {
      teardown();
      router.push(`${TOUR_HOME[role]}?${TOUR_QUERY_PARAM}=1`);
    }
  }, [begin, role, router, teardown]);

  useEffect(() => {
    if (!role) {
      return;
    }
    const onStart = () => start();
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, [role, start]);

  // Page changes: resume a hop, honour ?guide=1, or auto-start once.
  useEffect(() => {
    if (!role || pathname === "/") {
      return;
    }

    if (currentRef.current !== null && !hoppingRef.current) {
      // The page changed under an open tour (browser back): end it quietly.
      finish("left-page");
    }

    const pending = readPendingHop();
    if (pending) {
      writePendingHop(undefined);
      hoppingRef.current = false;
      const step = steps[pending.stepIndex];
      if (
        pending.role === role &&
        step &&
        Date.now() - pending.at < RESUME_MAX_AGE_MS &&
        stepMatchesPath(step, role, pathname)
      ) {
        void begin(pending.stepIndex, pending.direction, true);
        return;
      }
    }
    hoppingRef.current = false;

    let params: URLSearchParams | undefined;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      params = undefined;
    }
    if (params?.get(TOUR_QUERY_PARAM) === "1") {
      params.delete(TOUR_QUERY_PARAM);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
      void begin(0, 1, true);
      return;
    }

    if (
      !shouldAutoStart({
        role,
        pathname,
        seen: readSeen(role),
        signedIn: true,
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (
        currentRef.current !== null ||
        pathnameRef.current !== pathname ||
        !resolveStepElement(steps[0])
      ) {
        return;
      }
      void begin(WELCOME, 1, false);
    }, AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [begin, finish, pathname, role, router, steps]);

  const value = useMemo<TourContextValue | null>(
    () => (role ? { role, start } : null),
    [role, start],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
