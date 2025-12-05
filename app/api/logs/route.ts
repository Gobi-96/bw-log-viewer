import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";

export const runtime = "nodejs";

function execShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 5000 }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err);
      resolve(stdout);
    });
  });
}

export async function GET(req: NextRequest) {
  try {
    const serial = req.nextUrl.searchParams.get("serial");
    if (!serial) {
      return NextResponse.json(
        { error: "Missing serial parameter" },
        { status: 400 }
      );
    }

    const cmd = `
      gcloud logging read "labels.serial='${serial}'" \
      --project=bw-core --limit=500 --format=json
    `;

    const raw = await execShell(cmd);

    const entries = JSON.parse(raw);

    // Map into simplified format
    const parsed = entries.map((e: any) => ({
      timestamp: e.timestamp,
      severity: e.severity || "",
      message: e.textPayload || e.jsonPayload?.message || "",
      labels: e.labels,
    }));

    return NextResponse.json({ serial, count: parsed.length, logs: parsed });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.toString() },
      { status: 500 }
    );
  }
}
