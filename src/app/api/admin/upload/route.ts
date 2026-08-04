import { NextResponse } from "next/server";

import {
  ADMIN_CONTENT_UPLOAD_MAX_BYTES,
  AdminContentUploadError,
  buildAdminContentUploadPreview,
} from "@/lib/tutor/admin-content-upload";
import { authorizeApi, requireAdministrator } from "@/lib/auth/authorization";

export const runtime = "nodejs";

const MAX_MULTIPART_BYTES = ADMIN_CONTENT_UPLOAD_MAX_BYTES + 16_384;

export async function POST(request: Request) {
  const access = await authorizeApi(requireAdministrator);

  if (!access.ok) {
    return access.response;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json(
      { error: "Admin content uploads must be smaller than 512KB." },
      { status: 413 },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload must be multipart form data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");

  if (!isUploadedFile(file)) {
    return NextResponse.json(
      { error: "Upload must include a file field." },
      { status: 400 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const preview = await buildAdminContentUploadPreview({
      bytes,
      name: file.name,
      size: file.size,
      type: file.type,
    });

    return NextResponse.json({
      imported: false,
      preview,
      reviewStatus: "needs_review",
    });
  } catch (error) {
    if (error instanceof AdminContentUploadError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Unable to prepare a safe upload preview." },
      { status: 503 },
    );
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    typeof value.arrayBuffer === "function" &&
    typeof value.name === "string" &&
    typeof value.size === "number"
  );
}
