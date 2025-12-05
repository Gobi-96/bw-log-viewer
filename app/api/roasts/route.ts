// app/api/roasts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRoasts } from "../../../lib/getRoasts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const serial = url.searchParams.get("serial") || "";
    const from = url.searchParams.get("from") || undefined;
    const to = url.searchParams.get("to") || undefined;

    const page = Number(url.searchParams.get("page") || "1") || 1;
    const pageSize = Number(url.searchParams.get("pageSize") || "10") || 10;

    const result = await getRoasts(serial, from, to, page, pageSize);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Error loading roasts", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load roasts" },
      { status: 500 }
    );
  }
}
