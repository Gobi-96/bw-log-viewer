export interface MeasurementRow {
  time: number;
  temp: number | string;
  skin: number | string;
  referenceTemp?: number | string;
  adjustedTimeMMSS: string;
  ror?: number;
}

function secondsToMMSS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function addRiseRate(data: MeasurementRow[]): MeasurementRow[] {
  const threshold = 15;
  const left = 2;
  const right = 2;

  function getSlope(idx: number): number {
    if (idx < threshold || idx > data.length) return -10;
    const trail = data.slice(idx - threshold, idx);
    if (!trail.length) return -10;
    const first = trail[0];
    const last = trail[trail.length - 1];
    const deltaTemp = Number(last.temp) - Number(first.temp);
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

export function parseRoastMeasurementsCsv(csv: string): MeasurementRow[] {
  if (!csv) return [];
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0];
  if (!header.includes("raw_line")) return [];
  const rawIdx = header.split(",").findIndex((h) => h === "raw_line");
  const tsIdx = header.split(",").findIndex((h) => h === "timestamp");
  if (rawIdx === -1 || tsIdx === -1) return [];

  const dataLines = lines
    .slice(1)
    .map((l) => l.split(","))
    .filter((cols) => cols.length > rawIdx && /LOG\s+(Roast)/i.test(cols[rawIdx] || ""));

  dataLines.sort((a, b) => {
    const aTs = new Date(a[tsIdx] || "").getTime();
    const bTs = new Date(b[tsIdx] || "").getTime();
    return aTs - bTs;
  });

  if (!dataLines.length) return [];

  const timestampStart = new Date(dataLines[0][tsIdx]).getTime();

  const rows: MeasurementRow[] = [];
  for (const cols of dataLines) {
    const raw = cols[rawIdx] || "";
    const ts = cols[tsIdx] || "";
    const values = raw.split(",");
    // Expect ordering similar to plot CSV: bean front (5), drum bottom (6), roastSPF/reference (15 if present)
    if (values.length < 7) continue;
    const beanFront = Number(values[5]);
    const drumBottom = Number(values[6]);
    const roastSpf = values.length > 15 ? Number(values[15]) : undefined;
    const tsMs = new Date(ts).getTime();
    const elapsedSec =
      Number.isFinite(timestampStart) && Number.isFinite(tsMs)
        ? Math.max(0, Math.round((tsMs - timestampStart) / 1000))
        : 0;
    rows.push({
      time: elapsedSec,
      temp: beanFront,
      skin: drumBottom,
      referenceTemp: roastSpf,
      adjustedTimeMMSS: secondsToMMSS(elapsedSec),
    });
  }

  return addRiseRate(rows);
}
