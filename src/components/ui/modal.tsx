"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type ModalSize = "md" | "lg";

/**
 * Widths are capped against the viewport so the dialog still has a gutter on a
 * phone, where the UA's own `max-width` would otherwise hand it the full width.
 */
const SIZE_CLASS: Record<ModalSize, string> = {
  md: "w-[min(32rem,calc(100vw-2rem))]",
  lg: "w-[min(46rem,calc(100vw-2rem))]",
};

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  className?: string;
};

/**
 * A modal built on the native `<dialog>` element.
 *
 * `showModal()` gives us the top layer, the inert background, focus trapping,
 * and Escape for free — everything a hand-rolled overlay gets wrong. React owns
 * `open`, so the only thing this component adds is translating the browser's
 * own dismissals (Escape fires `cancel`, a click on the backdrop lands on the
 * dialog element itself) back into `onClose`, plus restoring focus to whatever
 * opened it.
 */
export function Modal({
  children,
  className,
  description,
  footer,
  onClose,
  open,
  size = "md",
  title,
}: ModalProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const reactId = React.useId();
  const titleId = `${reactId}-title`;
  const descriptionId = `${reactId}-description`;

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        dialog.showModal();
      }
      return;
    }
    if (dialog.open) {
      dialog.close();
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (previous?.isConnected) {
        previous.focus();
      }
    }
  }, [open]);

  // Unmounting while open would leave the page inert, so close on the way out.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: let React drive the close so `open` and the DOM stay in step.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className={cn(
        "m-auto max-h-[85vh] overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg",
        "backdrop:bg-black/40",
        SIZE_CLASS[size],
        className,
      )}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex flex-col gap-1.5 border-b border-border p-6">
          <h2 id={titleId} className="font-semibold tracking-tight">
            {title}
          </h2>
          {description ? (
            <div
              id={descriptionId}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {description}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer ? <ModalFooter>{footer}</ModalFooter> : null}
      </div>
    </dialog>
  );
}

/** The commit row: muted context on the left, actions on the right. */
export function ModalFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-footer"
      className={cn(
        "flex flex-col gap-3 border-t border-border bg-muted/20 p-6 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}
