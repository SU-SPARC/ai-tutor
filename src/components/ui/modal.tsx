"use client";

import * as React from "react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ModalSize = "md" | "lg";

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
 * The original controlled-modal API, now a thin wrapper over `Dialog` so there
 * is one dialog implementation. New code can use `Dialog` directly; existing
 * importers keep working unchanged.
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        size={size === "lg" ? "lg" : "md"}
        className={cn(className)}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer ? <ModalFooter>{footer}</ModalFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

/** The commit row: muted context on the left, actions on the right. */
export function ModalFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <DialogFooter
      data-slot="modal-footer"
      className={cn("sm:justify-between", className)}
      {...props}
    />
  );
}
