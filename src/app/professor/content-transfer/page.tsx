import { FileJson } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorContentTransferPanel } from "@/components/professor/professor-content-transfer-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";

export default async function ProfessorContentTransferPage() {
  await requirePageAccess(
    requireProfessorReview,
    "/professor/content-transfer",
  );

  return (
    <ProfessorPageShell
      title="Import and export question content"
      description="Preview validated question JSON, inspect row-level errors, and explicitly confirm imports. Importing an approved review state never publishes the question to students."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <FileJson className="h-4 w-4" />
          schema v1
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Question content transfer</CardTitle>
          <CardDescription>
            Production imports require database storage. Demo mode supports
            sanitized exports and read-only validation previews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorContentTransferPanel />
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}
