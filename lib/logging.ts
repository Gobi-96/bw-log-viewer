// lib/logging.ts
import { Logging } from "@google-cloud/logging";

export const projectId =
  process.env.GOOGLE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  "bw-core";

export const logging = new Logging({ projectId });
