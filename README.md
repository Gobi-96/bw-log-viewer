  # Bellwether Log Viewer (Next.js)

  Small Next.js app to browse Bellwether roaster logs from Google Cloud Logging. The backend talks directly to Cloud Logging; the frontend is a React UI for searching, paging,
  and exporting roast logs.

  ## Prerequisites
  - Node 18+
  - A GCP service account with read access to Cloud Logging (Viewer is enough)
  - Credentials available via ADC (e.g., service account JSON or workload identity)

  ## Setup
  1) Install deps:
     npm install
  2) Set env:
     - GOOGLE_PROJECT_ID (or GCLOUD_PROJECT) — defaults to bw-core if unset
     - GOOGLE_APPLICATION_CREDENTIALS — path to your service account JSON (or rely on default creds on GCP)

  ## Run
  - Dev: npm run dev
  - Prod: npm run build && npm start
  Default port: http://localhost:3000

  ## How it works
  - UI calls server routes from app/page.tsx.
  - /api/roasters: lists roasters by scanning recent entries with labels.serial from logs/roaster + logs/roastctl.
  - /api/logs: grabs the last hour for a serial to show online/offline and state.
  - /api/roasts: builds roast history for a date window (see lib/getRoasts.ts) and links to Logs Explorer.
  - /api/downloadLogs: snaps to start/end markers for a roast and streams a CSV.
  - All backend calls use @google-cloud/logging (logging.getEntries) with tight filters and capped page sizes; no BigQuery/Log Analytics queries run server-side. “Open in GCP”
  links only open Logs Explorer URLs.

   ## Sample Screenshots 
  <img width="1920" height="956" alt="image" src="https://github.com/user-attachments/assets/503443a5-0297-4a8c-b4bc-b0b88015056d" />

  <img width="1920" height="773" alt="image" src="https://github.com/user-attachments/assets/73d0c189-77ba-45f6-b37e-ae93d19f311b" />


  ## Notes
  - Filters pin logName to projects/<projectId>/logs/roaster (and roastctl where needed) and include labels.serial to keep queries small.
  - Change project via GOOGLE_PROJECT_ID or tweak lib/logging.ts if needed.
