import {
  ProfessorPageShell,
  type ProfessorBreadcrumb,
} from "@/components/professor/professor-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

type SkeletonShape = "overview" | "builder" | "topic" | "section";

function Rows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-panel bg-sheet p-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton className="h-8" key={index} />
      ))}
    </div>
  );
}

/**
 * What a Courses screen shows while the store is still loading the
 * professor's courses from the server.
 * Same frame and the same blocks as the real screen, so nothing jumps when the
 * record arrives.
 */
export function CourseScreenSkeleton({
  breadcrumbs,
  description,
  shape,
  title,
}: {
  breadcrumbs?: ProfessorBreadcrumb[];
  description: string;
  shape: SkeletonShape;
  title: string;
}) {
  return (
    <ProfessorPageShell
      breadcrumbs={breadcrumbs}
      description={description}
      title={title}
    >
      <p className="sr-only" role="status">
        Loading…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-8">
        {shape === "overview" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton className="h-36 rounded-panel" key={index} />
              ))}
            </div>
            <Rows count={3} />
            <Rows count={6} />
          </>
        ) : null}
        {shape === "builder" ? (
          <>
            <Skeleton className="h-11 w-64" />
            <div className="grid gap-4 lg:grid-cols-2 xl:gap-6">
              <Rows count={8} />
              <Rows count={8} />
            </div>
          </>
        ) : null}
        {shape === "topic" ? (
          <>
            <Skeleton className="h-9 w-96 max-w-full" />
            <Rows count={6} />
          </>
        ) : null}
        {shape === "section" ? (
          <>
            <Skeleton className="h-11 w-72 max-w-full" />
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton className="h-24 rounded-panel" key={index} />
              ))}
            </div>
            <Rows count={4} />
            <Rows count={6} />
          </>
        ) : null}
      </div>
    </ProfessorPageShell>
  );
}
