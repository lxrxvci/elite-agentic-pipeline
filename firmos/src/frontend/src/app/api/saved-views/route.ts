import { NextResponse } from "next/server";

import { requireStaff } from "@/server/auth/guards";
import {
  importSavedViews,
  listSavedViews,
  saveSavedView,
  type SavedViewContext,
  type WorkstationViewFilters,
} from "@/server/saved-views";

/**
 * Saved-view persistence over plain REST. The workstation seam previously
 * called server actions through an intermediate module and the dispatch
 * never fired under slow backends; a route handler is boring and works.
 */

type SaveBody = {
  context: SavedViewContext;
  name: string;
  filters: WorkstationViewFilters;
};

export async function GET(request: Request) {
  try {
    const user = await requireStaff();
    const context = new URL(request.url).searchParams.get("context") ?? "workstation";
    const views = await listSavedViews(user.id, context as SavedViewContext);
    return NextResponse.json({ ok: true, data: views });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireStaff();
    const body = (await request.json()) as SaveBody & { importOnly?: boolean };
    if (Array.isArray((body as never as { views?: unknown[] }).views)) {
      const withViews = body as unknown as {
        context: SavedViewContext;
        views: { name: string; filters: WorkstationViewFilters }[];
      };
      const imported = await importSavedViews(user.id, withViews.context, withViews.views);
      return NextResponse.json({ ok: true, data: { imported } });
    }
    const record = await saveSavedView(user.id, body.context, body.name, body.filters);
    return NextResponse.json({ ok: true, data: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
