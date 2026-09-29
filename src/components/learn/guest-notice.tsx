import Link from "next/link";

import { Alert } from "@/components/ui/alert";

const LINK_CLASSES =
  "rounded-xs text-azure-500 underline underline-offset-4 hover:text-azure-700 focus-ring";

/**
 * The guest line, word for word the same on `/learn` and on topic pages:
 * where the progress lives, one way to keep it, and the way in with a code.
 * Shown whenever the visitor is not a signed-in user, including a browser
 * that already has practice saved in it.
 */
export function GuestNoticeText({ returnTo }: { returnTo: string }) {
  return (
    <>
      Guest · your progress lives in this browser.{" "}
      <Link
        href={`/sign-in?callbackUrl=${encodeURIComponent(returnTo)}`}
        className={LINK_CLASSES}
      >
        Sign in to keep it
      </Link>{" "}
      · Have a section code?{" "}
      <Link href="/join" className={LINK_CLASSES}>
        Enter it
      </Link>
    </>
  );
}

/** The `/learn` version: the same words in a quiet info note. */
export function GuestNotice({ returnTo }: { returnTo: string }) {
  return (
    <Alert role="note" variant="info" className="mt-2 max-w-prose">
      <p className="type-body col-start-2 text-ink">
        <GuestNoticeText returnTo={returnTo} />
      </p>
    </Alert>
  );
}
