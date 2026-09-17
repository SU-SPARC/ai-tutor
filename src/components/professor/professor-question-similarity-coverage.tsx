import { BarChart3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { QuestionSimilarityCoverageDto } from "@/lib/types";

export function ProfessorQuestionSimilarityCoverage({
  coverage,
  topicTitle,
}: {
  coverage: QuestionSimilarityCoverageDto[];
  topicTitle: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" /> Dedicated sibling coverage
        </CardTitle>
        <CardDescription>
          {topicTitle}: active, eligible siblings pinned to each current
          published version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {coverage.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {coverage.map((row) => (
              <li
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                key={row.originQuestionId}
              >
                <span>{row.originTitle}</span>
                <Badge variant="outline">
                  {row.eligibleSiblingCount}/{row.targetSiblingCount}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No currently published questions are available for this topic.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
