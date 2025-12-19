export interface PlotRow {
  state: string;
  timeMMSS: string;
  heaterOut: number | string;
  inlet: number | string;
  bypassExit: number | string;
  beanFront: number | string;
  drumBottom: number | string;
  beanCooler: number | string;
  airSPF: number | string;
  airPWM: number | string;
  bluLbs: number | string;
  bluCooler?: number | string;
  bluTray?: number | string;
  bluTrayReady?: number | string;
  inletSPF: number | string;
  roastSPF: number | string;
  roastError: number | string;
  bypassPos: number | string;
  hopperState?: number | string;
  load?: number | string;
  drop?: number | string;
  trayPresent?: number | string;
  trayStatus?: number | string;
  beanCollector?: number | string;
  chaffCollector?: number | string;
  mbPCT: number | string;
  mbHz: number | string;
  exhstPct: number | string;
  exhstHz1: number | string;
  exhstHz2: number | string;
  coolTarget: number | string;
  htrVrms: number | string;
  htrIrms: number | string;
  iF: number | string;
  interLock?: number | string;
  alarms?: string;
  adjustedTimeMMSS: string;
  timestamp: string;
  time: number;
  ror?: number;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  out.push(current);
  return out;
}

function parseIotValue(raw: string): string | number {
  const value = raw.trim();
  if (value === "") return "";
  if (!isNaN(Number(value))) {
    return value.includes(".") ? Number(value) : Number.parseInt(value, 10);
  }
  if (value.length > 7) return value.replace(/^LOG/i, "").trim();
  return value;
}

function secondsToMMSS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function addRiseRate(data: PlotRow[]): PlotRow[] {
  const threshold = 15;
  const left = 2;
  const right = 2;

  function getSlope(idx: number): number {
    if (idx < threshold || idx > data.length) return -10;
    const trail = data.slice(idx - threshold, idx);
    if (!trail.length) return -10;
    const first = trail[0];
    const last = trail[trail.length - 1];
    const deltaTemp = Number(last.beanFront) - Number(first.beanFront);
    const deltaTime = Number(last.time) - Number(first.time);
    if (!deltaTime || Number.isNaN(deltaTemp)) return -10;
    return (30 * deltaTemp) / deltaTime;
  }

  function getRange(from: number, to: number): number[] {
    const out: number[] = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  }

  return data.map((item, idx) => {
    const slopes = getRange(idx - left, idx + right)
      .map(getSlope)
      .filter((s) => s !== -10 && Number.isFinite(s));
    const ror = slopes.length
      ? slopes.reduce((acc, s) => acc + s, 0) / slopes.length
      : -10;
    return { ...item, ror };
  });
}

export function parseRoastPlotCsv(csv: string): PlotRow[] {
  if (!csv) return [];
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = splitCsv(lines[0]);
  const rawIdx = header.findIndex((h) => h === "raw_line");
  const tsIdx = header.findIndex((h) => h === "timestamp");
  if (rawIdx === -1 || tsIdx === -1) return [];

  const dataLines = lines
    .slice(1)
    .map(splitCsv)
    .filter(
      (cols) =>
        cols.length > rawIdx && /LOG\s+(Preheat|Roast|Cool)/i.test(cols[rawIdx] || "")
    );

  dataLines.sort((a, b) => {
    const aTs = new Date(a[tsIdx] || "").getTime();
    const bTs = new Date(b[tsIdx] || "").getTime();
    return aTs - bTs;
  });

  if (!dataLines.length) return [];

  const timestampStart = new Date(dataLines[0][tsIdx]).getTime();

  const HEADERS35 = [
    "state",
    "timeMMSS",
    "heaterOut",
    "inlet",
    "bypassExit",
    "beanFront",
    "drumBottom",
    "beanCooler",
    "airSPF",
    "airPWM",
    "bluLbs",
    "bluCooler",
    "bluTray",
    "bluTrayReady",
    "inletSPF",
    "roastSPF",
    "roastError",
    "bypassPos",
    "hopperState",
    "load",
    "drop",
    "trayPresent",
    "trayStatus",
    "beanCollector",
    "mbPCT",
    "mbHz",
    "exhstPct",
    "exhstHz1",
    "exhstHz2",
    "coolTarget",
    "htrVrms",
    "htrIrms",
    "iF",
    "interLock",
    "alarms",
  ];

  const HEADERS36 = [
    "state",
    "timeMMSS",
    "heaterOut",
    "inlet",
    "bypassExit",
    "beanFront",
    "drumBottom",
    "beanCooler",
    "airSPF",
    "airPWM",
    "bluLbs",
    "bluCooler",
    "bluTray",
    "bluTrayReady",
    "inletSPF",
    "roastSPF",
    "roastError",
    "bypassPos",
    "hopperState",
    "load",
    "drop",
    "trayPresent",
    "trayStatus",
    "beanCollector",
    "chaffCollector",
    "mbPCT",
    "mbHz",
    "exhstPct",
    "exhstHz1",
    "exhstHz2",
    "coolTarget",
    "htrVrms",
    "htrIrms",
    "iF",
    "interLock",
    "alarms",
  ];

  const rows: PlotRow[] = [];

  for (const cols of dataLines) {
    const rawLine = cols[rawIdx] || "";
    const ts = cols[tsIdx] || "";
    const rawValues = splitCsv(rawLine);
    const total = rawValues.length;
    if (total !== 35 && total !== 36) continue;

    const headers = total === 35 ? HEADERS35 : HEADERS36;
    const item: any = {};
    for (let i = 0; i < total; i++) {
      item[headers[i]] = parseIotValue(rawValues[i]);
    }

    const tsMs = new Date(ts).getTime();
    const elapsedSec =
      Number.isFinite(timestampStart) && Number.isFinite(tsMs)
        ? Math.max(0, Math.round((tsMs - timestampStart) / 1000))
        : 0;

    item.adjustedTimeMMSS = secondsToMMSS(elapsedSec);
    item.timestamp = new Date(ts).toISOString();
    item.time = elapsedSec;
    rows.push(item as PlotRow);
  }

  return addRiseRate(rows);
}
