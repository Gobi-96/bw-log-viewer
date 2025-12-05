import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const cmd = `
      gcloud logging read "logName:roaster" \
      --project=bw-core --limit=500 --format=json
    `;

    const raw = await execShell(cmd);
    const entries = JSON.parse(raw);

    const map = new Map<string, any>();

    for (const e of entries) {
      const serial = e.labels?.serial;
      if (!serial) continue;

      if (!map.has(serial)) {
        map.set(serial, {
          serial,
          machineName: e.labels?.machine_name || "",
          model: e.labels?.model || "",
          firmware: e.labels?.version || "",
        });
      }
    }

    return NextResponse.json({
      total: map.size,
      roasters: Array.from(map.values()),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.toString() }, { status: 500 });
  }
}
