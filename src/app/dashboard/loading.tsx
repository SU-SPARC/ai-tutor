import { LearnSkeleton } from "@/components/learn/learn-skeleton";

/**
 * `/dashboard` only redirects to `/learn`, so its loading state is the Learn
 * page's, label and all.
 */
export default function DashboardLoading() {
  return <LearnSkeleton />;
}
