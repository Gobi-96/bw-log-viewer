import { NextRequest, NextResponse } from "next/server";
import { loadRoastLogEntries, buildRoastCsv } from "../../../lib/roastLogs";
import { parseRoastMeasurementsCsv } from "../../../lib/parseRoastMeasurements";
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
    let measurements = parseRoastMeasurementsCsv(csv);
    // Fallback: if no measurements were parsed, derive temp/skin from plot data
    if (!measurements.length) {
      const plots = parseRoastPlotCsv(csv).filter(
        (p) => (p.state || "").toLowerCase() === "roast"
      );
      measurements = plots.map((p) => ({
        time: p.time,
        temp: p.beanFront,
        skin: p.drumBottom,
        referenceTemp: (p as any).roastSPF,
        ror: p.ror,
        adjustedTimeMMSS: p.adjustedTimeMMSS,
      }));
    }
    return NextResponse.json({
      serial,
      roastId,
      start: startIso,
      end: endIso,
      count: measurements.length,
      measurements,
    });
  } catch (err: any) {
    console.error("Error loading measurements", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load measurements" },
      { status: 500 }
    );
  }
}
