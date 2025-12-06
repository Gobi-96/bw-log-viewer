import { NextRequest, NextResponse } from "next/server";
import { logging } from "../../../lib/logging";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const serial = req.nextUrl.searchParams.get("serial");
    const windowMinutes = Number(req.nextUrl.searchParams.get("windowMinutes") || "15");
    if (!serial) {
      return NextResponse.json(
        { error: "Missing serial parameter" },
        { status: 400 }
      );
    }

    const minutes = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 15;
    const startIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
`.trim();

    const [entries] = await logging.getEntries({
      filter,
      orderBy: "timestamp desc",
      pageSize: 200,
    });

    const parsed = (entries || []).map((e: any) => ({
      timestamp: e.timestamp,
      severity: e.severity || "",
      message: e.textPayload || e.jsonPayload?.message || "",
      labels: e.labels,
      receiveTimestamp: e.receiveTimestamp,
      metadata: e.metadata,
    }));

    return NextResponse.json({ serial, count: parsed.length, logs: parsed });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.toString() },
      { status: 500 }
    );
  }
}
