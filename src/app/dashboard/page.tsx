import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The dashboard and the topic index answered the same question — "what next?"
 * — so they are one page now. The URL stays alive because it is in browser
 * histories and in the header of every page shipped before the merge.
 */
export default function DashboardPage() {
  redirect("/learn");
}
