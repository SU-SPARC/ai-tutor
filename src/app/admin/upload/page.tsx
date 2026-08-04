import Link from "next/link";
import { ArrowLeft, UploadCloud } from "lucide-react";

import { AdminUploadPanel } from "@/components/admin/admin-upload-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ADMIN_CONTENT_UPLOAD_MAX_BYTES } from "@/lib/tutor/admin-content-upload";
import {
  requireAdministrator,
  requirePageAccess,
} from "@/lib/auth/authorization";

export default async function AdminUploadPage() {
  await requirePageAccess(requireAdministrator, "/admin/upload");
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 px-0">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <Badge variant="secondary" className="mb-3">
              Admin upload
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Content upload preview
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Upload private LaTeX or small PDF files for a needs-review
              metadata preview. Raw source material stays out of public records.
            </p>
          </div>
          <Badge variant="outline" className="h-10 gap-2 px-4">
            <UploadCloud className="h-4 w-4" />
            needs_review only
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Private reference upload</CardTitle>
            <CardDescription>
              Maximum file size:{" "}
              {Math.floor(ADMIN_CONTENT_UPLOAD_MAX_BYTES / 1024)}
              KB. PDFs are extracted to ignored private storage only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminUploadPanel />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
