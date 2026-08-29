import { NextResponse } from "next/server";

import { requireStaff } from "@/server/auth/guards";
import { deleteSavedView, type SavedViewContext } from "@/server/saved-views";

/** DELETE /api/saved-views/{name}?context=workstation - deletes the caller's view. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const user = await requireStaff();
    const { name } = await params;
    const context =
      (new URL(request.url).searchParams.get("context") as SavedViewContext | null) ??
      "workstation";
    await deleteSavedView(user.id, context, decodeURIComponent(name));
    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
