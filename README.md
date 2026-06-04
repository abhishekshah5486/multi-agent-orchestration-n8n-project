# JD↔Resume Fit Analyzer + Interview Kit — an Agentic n8n Workflow

An n8n workflow that screens a candidate against a job description, scores the fit
**deterministically**, routes the candidate into one of three lanes, lets an **AI agent**
draft the appropriate next action, and holds it for **human (recruiter) approval** before
anything is "sent". Built for the *Agentic Workflow Design* assignment.

> **One-line pitch:** Resume + JD in → recruiter gets a fit score, the right draft
> (interview kit / screening questions / rejection email), and a one-click approve/override —
> with a full audit log written to disk.

---

## 1. Problem statement

**User:** a recruiter or campus placement coordinator screening a high volume of applicants.

**Pain point:** screening is slow and inconsistent. Reading every résumé against a JD,
deciding who advances, and writing tailored interview questions or rejection emails is
repetitive, subjective, and easy to get wrong under volume. Pure-AI tools, on the other
hand, *hallucinate scores* and can auto-send a rejection to a strong candidate.

**Why it matters:** a bad screen either wastes interviewer time on weak fits or silently
drops great candidates. Recruiters need **speed from AI** but **control over the decision**.

**Output the workflow produces:**
1. A deterministic **fit score (0–100)** and band (`STRONG` / `MAYBE` / `WEAK`).
2. A **tailored draft** for the band: interview kit, screening-gap briefing, or rejection email.
3. A **recruiter approval step** (approve / override) before the action is finalized.
4. An **audit record** (JSON) written to disk for every decision.

---

## 2. Why this is *agentic*, not "one prompt"

This workflow deliberately separates **AI reasoning** from **deterministic control**. That
split is the whole point of the assignment, so here it is explicitly:

| Concern | Handled by | Node(s) |
|---|---|---|
| Pull structured facts out of messy résumé/JD text | **AI** (Information Extractor agents) | `Resume Extractor`, `JD Extractor` |
| Decide the fit score & band | **Deterministic code** (auditable math) | `Compute Fit Score` |
| Decide which lane to run | **Deterministic router** | `Route by Fit Band` (Switch) |
| Write the tailored, human-readable draft | **AI** (3 role-specialized writers) | `Interview Kit Writer`, `Gap Analysis Writer`, `Rejection Writer` |
| Approve / override the action | **Human-in-the-loop** | `Recruiter Approval` (Wait-for-form) |
| Guard bad input, gate on the decision, log | **Deterministic** | `Validate Input`, `Valid?`, `Approval Decision`, file log |

**Key design principle:** the *score is never produced by an LLM.* The AI only extracts
facts; a transparent function turns facts into a number. So the score is reproducible,
explainable, and can't hallucinate. The AI is used where judgement and language matter
(reading unstructured text, writing tailored drafts).

---

## 3. Workflow structure

```
                                                          ┌─ STRONG ─► Interview Kit Writer ─► Shape ─┐
 Intake Form ─► Validate ─► Valid? ─true─► Resume Extractor ─► JD Extractor ─► Compute Fit ─► Route ──┼─ MAYBE ──► Gap Analysis Writer ─► Shape ─┤
   (form)       (code)     (IF)             (AI/extract)        (AI/extract)     (CODE)     (switch) └─ WEAK ───► Rejection Writer ─────► Shape ─┘
                            │false                                                                                                         │
                            ▼                                                                          ┌──────────────────────────────────────┘
                  Fallback: Resubmit                                                                   ▼
                  (no AI spent)                                                          Recruiter Approval  ◄── HUMAN-IN-THE-LOOP (Wait for form)
                                                                                                       │
                                                                                          Approval Decision (switch)
                                                                                            │                    │
                                                                                       Approved             Overridden
                                                                                            ▼                    ▼
                                                                                     Finalize Record       Log Override
                                                                                            └──────┬─────────────┘
                                                                                                   ▼
                                                                                            Decision → JSON ─► Write Decision Log (disk)
```

A single **Groq Llama 3.3 70B** model node is shared by all five AI nodes (it connects via the
`ai_languageModel` port to each extractor and writer).

### Node-by-node

| # | Node | Type | Role |
|---|---|---|---|
| 1 | **Intake Form** | Form Trigger | Collects name, email, role, résumé text, JD text |
| 2 | **Validate Input** | Code | **Fallback guard** — rejects empty/short input *before* any AI cost |
| 3 | **Valid?** | IF | Branch to fallback vs. continue |
| 4 | **Fallback: Request Resubmit** | Set | Returns a clear error; spends zero AI |
| 5 | **Resume Extractor** | Information Extractor (AI) | Résumé text → `{skills[], years_experience, education, title, summary}` |
| 6 | **JD Extractor** | Information Extractor (AI) | JD text → `{must_have_skills[], nice_to_have_skills[], min_years, seniority}` |
| 7 | **Compute Fit Score** | Code | **Deterministic** overlap math → `fit_score`, `band`, matched/missing skills |
| 8 | **Route by Fit Band** | Switch | 3 outputs: STRONG / MAYBE / WEAK |
| 9 | **Groq Llama 3.3 70B** | Groq Chat Model | Shared LLM for all AI nodes (free, fast, generous limits) |
| 10 | **Interview Kit Writer** | LLM Chain (AI) | STRONG → focus areas + 5 tailored questions |
| 11 | **Gap Analysis Writer** | LLM Chain (AI) | MAYBE → key gaps + 3 screening questions + recommendation |
| 12 | **Rejection Writer** | LLM Chain (AI) | WEAK → warm, score-free rejection email |
| 13–15 | **Shape: …** | Set | Normalize each branch into `{action_type, draft, …}` |
| 16 | **Recruiter Approval** | Wait (form) | **HITL** — shows the draft, asks Approve / Override |
| 17 | **Approval Decision** | Switch | Gate on the human's choice |
| 18 | **Finalize Record** | Code | Build the final "sent" record |
| 19 | **Log Override** | Code | Record a recruiter override |
| 20 | **Decision → JSON** | Convert to File | Serialize the decision |
| 21 | **Write Decision Log** | Read/Write File | Persist audit JSON to `files/` |

### The deterministic scoring formula (`Compute Fit Score`)

```
skill_score = (matched_must_have / total_must_have) * 70
            + (matched_nice_to_have / total_nice_to_have) * 15
exp_score   = 15 if years >= required else (years / required) * 15
fit_score   = round(min(100, skill_score + exp_score))

band = STRONG if fit_score >= 75
       MAYBE  if 50 <= fit_score < 75
       WEAK   if fit_score < 50
```

Skills are matched with a fuzzy `contains` so `react.js` matches `react`. The thresholds
(`75` / `50`, the `70/15/15` weights) are policy knobs a recruiter owns — not AI guesses.

---

## 4. Agentic practices demonstrated (assignment checklist)

- **Role definition** — each AI node has one job: *extractor*, *interviewer*, *analyst*, *recruiter*.
- **Task decomposition** — extract → score → route → draft → approve → log, not one mega-prompt.
- **Structured outputs** — the extractors return strict JSON via the Information Extractor schema.
- **Tool / integration use** — Form Trigger (input), file system (audit log). Swappable for Google Sheets / Gmail (see §7).
- **Routing** — deterministic 3-way Switch on the computed band.
- **Deterministic control** — input validation, scoring math, threshold gating.
- **Human-in-the-loop** — recruiter must approve/override before an action is finalized.
- **Fallback / error handling** — the `Valid?` gate stops bad input before any AI spend.

---

## 5. Run it locally (Docker)

> Requires Docker Desktop. The workflow is **already imported** if you used the setup in this repo.

```bash
# Start n8n (persistent data + this repo mounted at /project)
docker run -d --name n8n -p 5678:5678 \
  -e N8N_SECURE_COOKIE=false -e N8N_RUNNERS_ENABLED=true \
  -e GENERIC_TIMEZONE=Asia/Kolkata -e WEBHOOK_URL=http://localhost:5678/ \
  -e N8N_RESTRICT_FILE_ACCESS_TO=/project \
  -v n8n_data:/home/node/.n8n \
  -v "$PWD":/project \
  docker.n8n.io/n8nio/n8n:latest
# N8N_RESTRICT_FILE_ACCESS_TO=/project lets the audit-log node write to ./files
# (n8n's default only permits ~/.n8n-files).

# Import the workflow
docker exec n8n n8n import:workflow --input=/project/workflow/jd-resume-fit-analyzer.json
```

Then:

1. Open **http://localhost:5678** and create the owner account (one-time, local only).
2. **Add the Groq credential:** get a free key at https://console.groq.com/keys (no card).
   In n8n: open the workflow → double-click the **Groq Llama 3.3 70B** node → *Credential to
   connect with* → **Create new credential** → paste the key → Save. (Creating it from the node
   auto-links it — don't add it via the sidebar or the node won't pick it up.)
3. Click **Test workflow**, open the form test URL, and paste a candidate from
   [`samples/sample_inputs.md`](samples/sample_inputs.md). (The one credential is shared by all
   five AI nodes, so you only configure it once.)
4. Watch the nodes light up → the **Recruiter Approval** form appears → approve or override →
   the decision JSON lands in [`files/`](files/).

Full step-by-step (with screenshots checklist) is in [`docs/SETUP.md`](docs/SETUP.md).

---

## 6. Sample input / output

- **Inputs:** [`samples/sample_inputs.md`](samples/sample_inputs.md) — three candidates that
  deterministically hit STRONG / MAYBE / WEAK, plus a fallback test.
- **Outputs:** example decision records in [`samples/`](samples/) and live runs in [`files/`](files/).

---

## 7. Limitations & possible improvements

- **Skill matching is lexical** (fuzzy contains), so synonyms like `k8s`↔`kubernetes` need the
  JD to spell them out. A small embedding step or a synonym map would harden this.
- **Logging is to local disk** for a zero-credential demo. Swapping the last two nodes for a
  **Google Sheets** *Append Row* or a **Gmail** *Send* node makes it production-ready (the
  HITL approval step already gates the send).
- **One candidate per submission.** A batch loop (read a Google Sheet of applicants) is a
  natural extension.
- Thresholds are global; a real deployment would make them per-role.

---

## 8. Repository contents

```
.
├── README.md                         # this file (problem + workflow explanation)
├── build_workflow.js                 # generator that emits the workflow JSON
├── workflow/
│   └── jd-resume-fit-analyzer.json   # exported n8n workflow (import this)
├── samples/
│   └── sample_inputs.md              # demo inputs for all branches
├── docs/
│   ├── SETUP.md                      # detailed local setup
│   ├── WORKFLOW_EXPLANATION.md       # deeper node + data-flow walkthrough
├── files/                            # decision audit logs land here at runtime
└── screenshots/                      # add your screenshots here for submission
```

---

## 9. Contribution note

This is an individual submission. The entire workflow — problem framing, the deterministic
scoring design, the three-way routing, the role-specialized AI agents, and the
human-in-the-loop approval gate — was designed and built by me. See
