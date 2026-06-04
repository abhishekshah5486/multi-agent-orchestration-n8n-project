# Setup — run the workflow locally

## Prerequisites
- Docker Desktop running.
- A **Groq API key** (free, no card): https://console.groq.com/keys

## 1. Start n8n
From the repo root:

```bash
docker volume create n8n_data
docker run -d --name n8n -p 5678:5678 \
  -e N8N_SECURE_COOKIE=false \
  -e N8N_RUNNERS_ENABLED=true \
  -e GENERIC_TIMEZONE=Asia/Kolkata \
  -e WEBHOOK_URL=http://localhost:5678/ \
  -e N8N_RESTRICT_FILE_ACCESS_TO=/project \
  -v n8n_data:/home/node/.n8n \
  -v "$PWD":/project \
  docker.n8n.io/n8nio/n8n:latest
```
> `N8N_RESTRICT_FILE_ACCESS_TO=/project` is required for the **Write Decision Log** node — n8n's
> default only allows file writes to `~/.n8n-files`, so without it the audit-log step fails with
> *"file is not writable"*.

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

## 4. Add the Groq credential (do this from the node so it auto-links)
1. Open the **JD↔Resume Fit Analyzer + Interview Kit** workflow.
2. Double-click the **Groq Llama 3.3 70B** node.
3. *Credential to connect with* → **Create new credential** → paste your Groq key → **Save**.
4. (Optional) confirm the model is `llama-3.3-70b-versatile`. Save.

> Tip: create the credential **from the node dropdown**, not the Credentials sidebar — that way
> it links automatically. (A sidebar-created credential won't attach itself to the node.)

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

## Groq free-tier rate limits
Groq's free tier is generous (~30 requests/min, ~1,000/day for `llama-3.3-70b-versatile`), and
one run makes only ~3 calls — so you're very unlikely to hit a limit during a demo. The AI nodes
also have **Retry on Fail** (3 tries, 8s apart) to absorb any transient `429`. If you ever do hit
one, just wait a few seconds and rerun, or pick another free Groq model on the node (e.g.
`llama-3.1-8b-instant` or `openai/gpt-oss-20b`).

## Troubleshooting
- **AI node error "credentials not set"** → open the `Groq Llama 3.3 70B` node and re-select your
  credential from the dropdown (this is the one link that doesn't travel with the exported JSON).
- **Model not found / decommissioned** → open the model node and pick a current model from the
  dropdown (Groq rotates models; `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` are safe).
- **`429 / rate limit`** → rare on Groq free tier; wait a few seconds and rerun.
- **Form URL 404** → in test mode the URL only works right after clicking *Test workflow*;
  re-click it. In production mode the workflow must be **Active**.
- **Nothing written to `files/`** → ensure the repo is mounted at `/project` (the `-v "$PWD":/project`
  flag) and that `files/` is writable (`chmod 777 files`).
- **Reset everything** → `docker rm -f n8n && docker volume rm n8n_data` then redo from step 1.
