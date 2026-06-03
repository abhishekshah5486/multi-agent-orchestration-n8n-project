# Setup — run the workflow locally

## Prerequisites
- Docker Desktop running.
- A **Google Gemini API key** (free): https://aistudio.google.com/apikey

## 1. Start n8n
From the repo root:

```bash
docker volume create n8n_data
docker run -d --name n8n -p 5678:5678 \
  -e N8N_SECURE_COOKIE=false \
  -e N8N_RUNNERS_ENABLED=true \
  -e GENERIC_TIMEZONE=Asia/Kolkata \
  -e WEBHOOK_URL=http://localhost:5678/ \
  -v n8n_data:/home/node/.n8n \
  -v "$PWD":/project \
  docker.n8n.io/n8nio/n8n:latest
```

Check it's up:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5678/healthz   # expect 200
```

## 2. Import the workflow
```bash
docker exec n8n n8n import:workflow --input=/project/workflow/jd-resume-fit-analyzer.json
```
Expect: `Successfully imported 1 workflow.`

## 3. Owner account (one-time)
Open http://localhost:5678 → set up the local owner account (email + password — local only,
nothing leaves your machine).

## 4. Add the Gemini credential
1. Left sidebar → **Credentials** → **Add credential**.
2. Search **"Google Gemini(PaLM) Api"**.
3. Paste your API key. Name it exactly **`Google Gemini account`**.
4. Save.

## 5. Attach the credential to the model node
1. Open the **JD↔Resume Fit Analyzer + Interview Kit** workflow.
2. Double-click the **Gemini 2.0 Flash** node.
3. Under *Credential to connect with*, select **Google Gemini account**.
4. (Optional) confirm the model is `models/gemini-2.0-flash`. Save.

All five AI nodes share this one model node, so you only configure it once.

## 6. Run a demo (test mode — most visual for recording)
1. Click **Test workflow** (bottom bar).
2. The **Intake Form** node shows a **Test URL** — open it.
3. Paste a candidate from `samples/sample_inputs.md` and submit.
4. Watch nodes execute. Execution pauses at **Recruiter Approval**.
5. n8n shows the approval form (open the waiting execution / the form URL). Pick
   **APPROVE** or **REJECT**, add notes, submit.
6. The decision JSON is written to `files/decision_<email>_<timestamp>.json`.

```bash
ls -t files/ | head        # see the latest decision log
cat files/$(ls -t files | head -1)
```

## 7. Production mode (stable URLs, for repeated demos)
Toggle the workflow **Active**. Then:
- Intake form: **http://localhost:5678/form/candidate-intake**
- The approval form URL is generated per run and shown in the execution.

## Troubleshooting
- **AI node error "credentials not set"** → redo step 5 on the `Gemini 2.0 Flash` node.
- **Model not found** → open the model node, re-pick a model from the dropdown (e.g.
  `models/gemini-2.0-flash` or `models/gemini-1.5-flash`).
- **Form URL 404** → in test mode the URL only works right after clicking *Test workflow*;
  re-click it. In production mode the workflow must be **Active**.
- **Nothing written to `files/`** → ensure the repo is mounted at `/project` (the `-v "$PWD":/project`
  flag) and that `files/` is writable (`chmod 777 files`).
- **Reset everything** → `docker rm -f n8n && docker volume rm n8n_data` then redo from step 1.
