import { UploadCloud } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorUploadPanel } from "@/components/professor/professor-upload-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PROFESSOR_CONTENT_UPLOAD_MAX_BYTES } from "@/lib/tutor/professor-content-upload";
import { requireProfessor, requirePageAccess } from "@/lib/auth/authorization";

export default async function ProfessorUploadPage() {
  await requirePageAccess(requireProfessor, "/professor/upload");
  return (
    <ProfessorPageShell
      title="Content upload preview"
      description="Upload private LaTeX or small PDF files for a needs-review metadata preview. Raw source material stays out of public records."
      aside={
        <Badge variant="outline" className="h-10 gap-2 px-4">
          <UploadCloud className="h-4 w-4" />
          needs_review only
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Private reference upload</CardTitle>
          <CardDescription>
            Maximum file size:{" "}
            {Math.floor(PROFESSOR_CONTENT_UPLOAD_MAX_BYTES / 1024)}
            KB. PDFs are extracted to ignored private storage only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfessorUploadPanel />
        </CardContent>
      </Card>
    </ProfessorPageShell>
  );
}
