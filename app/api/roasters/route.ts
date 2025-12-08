import { NextResponse } from "next/server";
import { logging } from "../../../lib/logging";

export const runtime = "nodejs";

function normalizeTs(ts: any): string | undefined {
  if (!ts) return undefined;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "object") {
    const seconds = Number(ts.seconds ?? ts._seconds ?? ts.value?.seconds ?? 0);
    const nanos = Number(ts.nanos ?? ts._nanos ?? ts.value?.nanos ?? 0);
    if (!Number.isFinite(seconds)) return undefined;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }
  return undefined;
}

function extractSerial(entry: any): string | undefined {
  const labels =
    entry.labels ||
    entry.metadata?.labels ||
    entry.resource?.labels ||
    entry.data?.labels ||
    {};

  const direct =
    labels.serial ||
    labels.serial_number ||
    labels.serialNumber ||
    labels.device_id ||
    labels.deviceId;
  if (direct) return String(direct);

  // Try payload fields
  const jp = entry.jsonPayload || entry.payload || entry.protoPayload || {};
  if (jp.serial) return String(jp.serial);
  if (jp.serial_number) return String(jp.serial_number);
  if (jp.serialNumber) return String(jp.serialNumber);

  // Try to parse from textPayload
  const text = entry.textPayload || jp.message || "";
  const match = String(text).match(/\bPS\d{5}\b/i);
  if (match && match[0]) return match[0].toUpperCase();

  return undefined;
}

export async function GET() {
  try {
    // Broad filter to include all roaster/roastctl logs (no time bound to catch long-offline units)
    const filter = `
logName=("projects/bw-core/logs/roaster" OR "projects/bw-core/logs/roastctl")
`.trim();

    let [entries] = await logging.getEntries({
      filter,
      orderBy: "timestamp desc",
      pageSize: 10000,
    });

    // Fallback: if nothing returned, try without time bound (some projects may log infrequently)
    if (!entries || entries.length === 0) {
      const fallbackFilter = `
logName=("projects/bw-core/logs/roaster" OR "projects/bw-core/logs/roastctl")
`.trim();
      [entries] = await logging.getEntries({
        filter: fallbackFilter,
        orderBy: "timestamp desc",
        pageSize: 10000,
      });
    }

    const map = new Map<string, any>();

    for (const entry of entries as any[]) {
      const serial = extractSerial(entry);
      if (!serial) continue;

      const ts = normalizeTs(entry.timestamp || entry.metadata?.timestamp);
      const labels =
        entry.labels ||
        entry.metadata?.labels ||
        entry.resource?.labels ||
        {};
      const machineName =
        labels.machine_name ||
        labels.machineName ||
        labels["machine-name"] ||
        "";
      const model = labels.model || "";
      const firmware = labels.version || labels.firmware || "";

      const existing = map.get(serial) || {
        serial,
        machineName,
        model,
        firmware,
        lastSeen: undefined as string | undefined,
      };

      // Update lastSeen with the latest timestamp we encounter (entries are desc)
      if (ts) {
        if (!existing.lastSeen) {
          existing.lastSeen = ts;
        } else {
          const prev = new Date(existing.lastSeen).getTime();
          const curr = new Date(ts).getTime();
          if (Number.isFinite(curr) && Number.isFinite(prev) && curr > prev) {
            existing.lastSeen = ts;
          }
        }
      }

      // Prefer non-empty metadata when blank
      if (!existing.machineName && machineName) existing.machineName = machineName;
      if (!existing.model && model) existing.model = model;
      if (!existing.firmware && firmware) existing.firmware = firmware;

      map.set(serial, existing);
    }

    const roasters = Array.from(map.values());

    return NextResponse.json({
      total: roasters.length,
      roasters,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.toString() }, { status: 500 });
  }
}
