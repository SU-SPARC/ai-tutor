"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The one confirmation the Courses demo uses in place of `window.confirm`:
 * a small Dialog whose buttons name what happens. Escape and Cancel change
 * nothing, and focus goes back to the button that opened it.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence: what changes, and for whom. */
  description: ReactNode;
  /** Optional extra line under the description. */
  children?: ReactNode;
  /** Names the action: "Regenerate code", "Archive Sec 02". */
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children ? <DialogBody>{children}</DialogBody> : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            type="button"
            variant={destructive ? "destructive" : "primary"}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
