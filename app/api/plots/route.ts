import { NextRequest, NextResponse } from "next/server";
import { loadRoastLogEntries, buildRoastCsv } from "../../../lib/roastLogs";
import { parseRoastPlotCsv } from "../../../lib/parseRoastCsv";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const serial = url.searchParams.get("serial") || "";
  const roastId = url.searchParams.get("roastId") || "";
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  const slackSeconds = Number(url.searchParams.get("slackSeconds") || "10");

  if (!serial || !start) {
    return NextResponse.json(
      { error: "Missing serial or start" },
      { status: 400 }
    );
  }

  try {
    const { startIso, endIso, entries } = await loadRoastLogEntries(
      serial,
      roastId,
      start,
      end,
      slackSeconds
    );
    const csv = buildRoastCsv(entries);
    const plots = parseRoastPlotCsv(csv);
    return NextResponse.json({
      serial,
      roastId,
      start: startIso,
      end: endIso,
      count: plots.length,
      plots,
    });
  } catch (err: any) {
    console.error("Error loading plots", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load plots" },
      { status: 500 }
    );
  }
}
