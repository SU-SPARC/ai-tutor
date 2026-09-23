import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The topic index is now zone 3 of `/learn`. */
export default function TopicsPage() {
  redirect("/learn");
}
