import { NextRequest } from "next/server";
import { logging } from "../../../lib/logging";

export const runtime = "nodejs";

function toIso(val: string | null) {
  if (!val) return "";
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

function csvEscape(value: any) {
  if (value === null || value === undefined) return "";
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

function normalizeTs(ts: any): string {
  if (!ts) return "";
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "object") {
    const seconds = Number(ts.seconds ?? ts._seconds ?? ts.value?.seconds ?? 0);
    const nanos = Number(ts.nanos ?? ts._nanos ?? ts.value?.nanos ?? 0);
    if (!Number.isFinite(seconds)) return "";
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }
  return "";
}

function extractMessage(entry: any): string {
  if (!entry) return "";
  if (entry.textPayload) return String(entry.textPayload);
  if (entry.data) return String(entry.data);
  const jp = entry.jsonPayload;
  if (jp) {
    if (typeof jp === "string") return jp;
    if (typeof jp.message === "string") return jp.message;
    try {
      return JSON.stringify(jp);
    } catch {
      // ignore
    }
  }
  return "";
}

function isReadyTransition(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes("ready") && lower.includes("state transition");
}

async function findRoastStartTimestamp(
  serial: string,
  roastId: string,
  approxStartIso: string,
  approxEndIso: string
): Promise<string> {
  if (!roastId || !approxStartIso) return approxStartIso;

  const startMs = new Date(approxStartIso).getTime();
  const endMs = new Date(approxEndIso || approxStartIso).getTime();
  const searchStart = new Date(startMs - 15 * 60 * 1000).toISOString(); // 15m before
  const searchEnd = new Date(Math.max(startMs + 30 * 60 * 1000, endMs)).toISOString(); // up to 30m after

  const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${searchStart}"
timestamp <= "${searchEnd}"
(textPayload:"Roast ID Received" OR textPayload:"SRID" OR textPayload:"${roastId}" OR jsonPayload.message:"Roast ID Received" OR jsonPayload.message:"SRID" OR jsonPayload.message:"${roastId}")
`.trim();

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp asc",
    pageSize: 400,
  });

  for (const e of entries as any[]) {
    const ts = normalizeTs(e.timestamp || e.metadata?.timestamp);
    if (!ts) continue;
    const raw = extractMessage(e);
    if (!raw) continue;
    if (!raw.includes(roastId)) continue;
    return ts;
  }

  return approxStartIso;
}

async function findRoastEndTimestamp(
  serial: string,
  startIso: string,
  defaultEndIso: string
): Promise<string> {
  if (!startIso) return defaultEndIso;
  const startMs = new Date(startIso).getTime();
  const readyDelayMs = 3000; // ignore Ready transitions that occur immediately (previous roast)

  const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
timestamp <= "${defaultEndIso}"
(textPayload:"Ready" OR jsonPayload.message:"Ready" OR textPayload:"State Transition" OR jsonPayload.message:"State Transition")
`.trim();

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp asc",
    pageSize: 1200,
  });

  for (const e of entries as any[]) {
    const ts = normalizeTs(e.timestamp || e.metadata?.timestamp);
    if (!ts) continue;
    const tsMs = new Date(ts).getTime();
    if (tsMs - startMs < readyDelayMs) continue;

    const raw = extractMessage(e);
    if (!raw) continue;
    if (isReadyTransition(raw)) {
      return ts;
    }
  }

  return defaultEndIso;
}

export async function GET(req: NextRequest) {
  try {
    const serial = req.nextUrl.searchParams.get("serial") || "";
    const roastId = req.nextUrl.searchParams.get("roastId") || "";
    const start = toIso(req.nextUrl.searchParams.get("start"));
    const end = toIso(req.nextUrl.searchParams.get("end"));
    const slackSeconds = Number(req.nextUrl.searchParams.get("slackSeconds") || "10");

    if (!serial || !start) {
      return new Response(JSON.stringify({ error: "Missing serial or start" }), {
        status: 400,
      });
    }

    // Pull a bit before/after to capture surrounding context; keep buffer user-controlled
    const startBufferSec = Math.max(0, slackSeconds);
    const endBufferSec = Math.max(0, slackSeconds);

    const startTime = new Date(start).getTime() - startBufferSec * 1000;
    let startIso = new Date(startTime).toISOString();

    let endIso = end;
    if (!endIso) {
      endIso = new Date(new Date(start).getTime() + 90 * 60 * 1000).toISOString();
    } else {
      const endTime = new Date(endIso).getTime() + endBufferSec * 1000;
      endIso = new Date(endTime).toISOString();
    }

    // Snap window to roast markers: start at Roast ID Received/SRID, end at Cool→Ready transition (3s after start to avoid previous roast)
    startIso = await findRoastStartTimestamp(serial, roastId, startIso, endIso);
    endIso = await findRoastEndTimestamp(serial, startIso, endIso);

    const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
timestamp <= "${endIso}"
`.trim();

    const [entries] = await logging.getEntries({
      filter,
      orderBy: "timestamp asc",
      pageSize: 6000,
    });

    const rows: string[] = [];
    rows.push(["logName", "hostname", "timestamp_upld", "timestamp", "raw_line"].map(csvEscape).join(","));

    for (const e of entries as any[]) {
      const logName = e.logName || e.metadata?.logName || "";
      const hostname = e.labels?.machine_name || e.labels?.machineName || "";
      const timestamp_upld = normalizeTs(e.receiveTimestamp || e.metadata?.receiveTimestamp);
      const ts = normalizeTs(e.timestamp || e.metadata?.timestamp);
      const raw = extractMessage(e);
      rows.push([logName, hostname, timestamp_upld, ts, raw].map(csvEscape).join(","));
    }

    const csv = rows.join("\r\n");

    // File naming: PS00015_12_6_2025_startTime.csv (UTC date components + start time)
    const startDate = new Date(startIso);
    const safeDate = Number.isFinite(startDate.getTime()) ? startDate : new Date();
    const month = safeDate.getUTCMonth() + 1; // 1-12
    const day = safeDate.getUTCDate(); // 1-31
    const year = safeDate.getUTCFullYear();
    const timePart = startIso
      ? (startIso.split("T")[1] || "time").replace("Z", "").replace(/\..*/, "").replace(/:/g, "_")
      : "time";
    const filename = `${serial}_${month}_${day}_${year}_${timePart}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Failed to download logs" }), {
      status: 500,
    });
  }
}
