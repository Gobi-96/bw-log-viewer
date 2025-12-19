import { logging, logProjectId } from "./logging";

export interface RoastLogEntry {
  logName: string;
  hostname: string;
  timestamp_upld: string;
  timestamp: string;
  raw_line: string;
}

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

  const jp = entry.jsonPayload;
  const pp = entry.protoPayload;
  const payload = entry.payload;
  const candidates = [
    entry.textPayload,
    entry.data,
    jp?.raw_line,
    jp?.rawLine,
    jp?.raw,
    jp?.line,
    pp?.raw_line,
    pp?.rawLine,
    pp?.raw,
    pp?.line,
    pp?.textPayload,
    pp?.message,
    pp?.body,
    payload?.raw_line,
    payload?.rawLine,
    payload?.raw,
    payload?.line,
    payload?.textPayload,
    payload?.message,
    payload?.body,
    entry.metadata?.textPayload,
    typeof jp === "string" ? jp : null,
    typeof jp?.message === "string" ? jp.message : null,
    typeof pp === "string" ? pp : null,
    typeof payload === "string" ? payload : null,
  ];

  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string") return c;
    try {
      if (typeof c !== "object") return String(c);
    } catch {
      // ignore
    }
  }

  if (jp) {
    try {
      return JSON.stringify(jp);
    } catch {
      // ignore
    }
  }
  return "";
}

export async function loadRoastLogEntries(
  serial: string,
  roastId: string,
  start: string,
  end?: string,
  slackSeconds: number = 10
): Promise<{ startIso: string; endIso: string; entries: RoastLogEntry[] }> {
  const startIsoInput = toIso(start);
  const endIsoInput = toIso(end || null);

  if (!serial || !startIsoInput) {
    throw new Error("Missing serial or start");
  }

  const startBufferSec = Math.max(0, slackSeconds);
  const endBufferSec = Math.max(0, slackSeconds);

  const startTime = new Date(startIsoInput).getTime() - startBufferSec * 1000;
  let startIso = new Date(startTime).toISOString();

  let endIso = endIsoInput;
  if (!endIso) {
    endIso = new Date(
      new Date(startIsoInput).getTime() + 90 * 60 * 1000
    ).toISOString();
  } else {
    const endTime = new Date(endIso).getTime() + endBufferSec * 1000;
    endIso = new Date(endTime).toISOString();
  }

  const filter = `
logName="projects/${logProjectId}/logs/roaster"
labels.serial="${serial}"
timestamp >= "${startIso}"
timestamp <= "${endIso}"
`.trim();

  const [entries] = await logging.getEntries({
    filter,
    orderBy: "timestamp asc",
    pageSize: 6000,
  });

  const parsed: RoastLogEntry[] = [];

  for (const e of entries as any[]) {
    const logName = e.logName || e.metadata?.logName || "";
    const hostname = e.labels?.machine_name || e.labels?.machineName || "";
    const timestamp_upld = normalizeTs(
      e.receiveTimestamp || e.metadata?.receiveTimestamp
    );
    const ts = normalizeTs(e.timestamp || e.metadata?.timestamp);
    const raw = extractMessage(e);
    parsed.push({
      logName,
      hostname,
      timestamp_upld,
      timestamp: ts,
      raw_line: raw,
    });
  }

  return { startIso, endIso, entries: parsed };
}

export function buildRoastCsv(entries: RoastLogEntry[]): string {
  const rows: string[] = [];
  rows.push(
    ["logName", "hostname", "timestamp_upld", "timestamp", "raw_line"]
      .map(csvEscape)
      .join(",")
  );
  for (const e of entries) {
    rows.push(
      [e.logName, e.hostname, e.timestamp_upld, e.timestamp, e.raw_line]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\r\n");
}
