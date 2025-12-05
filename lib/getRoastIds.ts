// lib/getRoastIds.ts
import { logging } from "./logging";

export interface RoastStartEvent {
  roastId: string;
  timestamp: string;
  raw: string;
  eventType: "start" | "end" | "unknown";
}

// UUID extractor (simple, robust)
function extractUuid(text: string): string | null {
  const uuidRegex =
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

  const match = text.match(uuidRegex);
  return match ? match[0] : null;
}

// Required because GCP timestamps may include nanos
function normalizeTimestamp(ts: any): string | null {
  if (!ts) return null;

  if (typeof ts === "string") {
    const fixed = ts.replace(/\.(\d{3})\d+Z$/, ".$1Z");
    const d = new Date(fixed);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (ts instanceof Date) return ts.toISOString();

  if (typeof ts === "object") {
    const seconds = Number(ts.seconds ?? ts._seconds ?? ts.value?.seconds ?? 0);
    const nanos = Number(ts.nanos ?? ts._nanos ?? ts.value?.nanos ?? 0);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }

  return null;
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
      // fall through
    }
  }

  return "";
}

function classifyEvent(text: string): "start" | "end" | "unknown" {
  const lower = text.toLowerCase();
  if (lower.includes("end of roast id")) return "end";
  if (lower.includes("roast id received")) return "start";
  if (lower.includes("srid")) return "start";
  return "unknown";
}

export async function getRoastIds(
  serial: string,
  fromIso: string,
  toIso: string
) {
  console.log("🔥 ROAST ID SEARCH WINDOW:", fromIso, "→", toIso);

  // EXACT terminal-equivalent filter
  const filter = `
logName="projects/bw-core/logs/roaster"
labels.serial="${serial}"
timestamp >= "${fromIso}"
timestamp < "${toIso}"
(
  textPayload:"Roast ID Received" OR
  textPayload:"End of Roast ID" OR
  textPayload:"SRID" OR
  jsonPayload.message:"Roast ID Received" OR
  jsonPayload.message:"End of Roast ID" OR
  jsonPayload.message:"SRID"
)
`.trim();

  // Fetch logs
  const [entries] = await logging.getEntries({
    filter,
    pageSize: 3000,
    orderBy: "timestamp asc",
  });

  console.log("🔥 Raw Roast Log Count:", entries.length);
  if (entries.length > 0) {
    const sample: any = entries[0];
    console.log("🔥 Sample entry keys:", Object.keys(sample));
    try {
      console.log("🔥 Sample entry data:", JSON.stringify(sample.data || sample.textPayload || sample, null, 2).slice(0, 800));
    } catch {
      // ignore
    }
  }

  const results: RoastStartEvent[] = [];

  for (const entry of entries) {
    const e: any = entry;

    const text: string = extractMessage(e);
    if (!text) continue;

    const roastId = extractUuid(text);
    if (!roastId) continue;
    const ts = normalizeTimestamp(e.timestamp || e.metadata?.timestamp);
    if (!ts) continue;
    const eventType = classifyEvent(text);

    results.push({
      roastId,
      timestamp: ts,
      raw: text.trim(),
      eventType,
    });
  }

  console.log("🔥 Extracted Roast IDss:", results.length);
  return results;
}
