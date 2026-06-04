# Workflow explanation (deep dive)

This document walks the data through the workflow end-to-end and explains *why* each node
exists. Use it to answer "explain your workflow" questions confidently.

## The mental model

> **AI reads and writes. Code decides.**

Large language models are great at turning messy text into structured facts and at writing
tailored prose. They are *bad* at being a consistent, auditable decision engine. So this
workflow uses AI only for **extraction** and **drafting**, and keeps every **decision**
(score, route, gate) in deterministic code. That separation is the core design choice.

## Stage 1 — Intake (deterministic)

**Intake Form** collects 5 fields: Candidate Name, Candidate Email, Role Title, Resume Text,
Job Description. A Form Trigger is used (rather than a chat box) because screening is a
structured task with known inputs — this is "structured input" as an agentic practice.

**Validate Input** (Code) is the **fallback guard**. It trims the résumé and JD and checks
minimum length (80 chars) and a basic email shape. It attaches `_valid` and `_errors`.

**Valid?** (IF) branches:
- `false` → **Fallback: Request Resubmit** returns the error list and stops. *No AI is called*,
  so malformed input costs nothing. This is deliberate cost/error control.
- `true` → continue to extraction.

## Stage 2 — Extraction (AI, structured output)

**Resume Extractor** and **JD Extractor** are *Information Extractor* nodes — purpose-built
n8n agent nodes that force the LLM to return JSON matching a schema:

- Resume → `{ skills[], years_experience, highest_education, current_title, summary }`
- JD → `{ must_have_skills[], nice_to_have_skills[], min_years_experience, seniority }`

Each reads the raw text straight from the form via an expression
(`{{ $('Intake Form').item.json['Resume Text'] }}`), so the original input is preserved even
though the node output is the structured object. Both share the single **Groq Llama 3.3 70B**
model node through the `ai_languageModel` connection.

Why two separate extractors? **Role separation.** Each has one schema and one job, which makes
the prompts simple and the output reliable — a classic agentic decomposition.

## Stage 3 — Scoring (deterministic, the heart of the design)

**Compute Fit Score** (Code) is pure math, no AI:

1. Lower-case and trim all skills.
2. Fuzzy-match résumé skills against the JD's must-have and nice-to-have lists
   (`contains` both ways, so `react.js` ≈ `react`).
3. `skill_score = (matched_must/total_must)*70 + (matched_nice/total_nice)*15`
4. `exp_score = 15` if candidate years ≥ required, else proportional.
5. `fit_score = round(min(100, skill_score + exp_score))`.
6. Band: `STRONG ≥ 75`, `MAYBE 50–74`, `WEAK < 50`.

It emits everything downstream needs: score, band, matched/missing skills, and the
candidate's contact info (pulled forward from the form). Because it's deterministic, the
same résumé + JD always yields the same score — explainable and testable.

## Stage 4 — Routing (deterministic)

**Route by Fit Band** (Switch) has three outputs keyed on `band`. This is the workflow's
decision branch — and it's driven by the *computed* band, never by an LLM's opinion.

## Stage 5 — Drafting (AI, role-specialized)

Exactly one writer runs, depending on the lane:

- **Interview Kit Writer** (STRONG): focus areas + 5 tailored interview questions (each with
  what it assesses) + a one-line recommendation.
- **Gap Analysis Writer** (MAYBE): the 2–3 key gaps + 3 screening questions + an explicit
  **ADVANCE TO SCREEN / HOLD** recommendation.
- **Rejection Writer** (WEAK): a warm, professional rejection email that never reveals the
  internal score.

These are *generation* tasks, so they output human-readable Markdown (no rigid schema needed —
a recruiter reads them). Each prompt is injected with the computed facts via expressions, so
the draft is grounded in the actual match/miss data, not re-derived by the model.

**Shape: …** (Set) nodes normalize each branch's output into a common shape
(`action_type`, `draft`, `candidate_name`, `role_title`, `fit_score`, `band`) so a *single*
approval node can handle all three lanes.

## Stage 6 — Human-in-the-loop (the safety net)

**Recruiter Approval** is a Wait node that resumes on form submission. Its description renders
the candidate summary **and the AI draft**, so the recruiter sees exactly what would be sent.
They pick **APPROVE** or **REJECT (override)** and can add notes.

This is the most important agentic practice here: the AI never takes an irreversible action
(sending a rejection, booking an interview) on its own. A human gates every high-impact output.

## Stage 7 — Decision gate + audit (deterministic)

**Approval Decision** (Switch) routes on the human's choice:
- **Approved** → **Finalize Record** builds the final record including the message to send.
  It selects the right draft by `band` (guarded `if/else` so it only references the writer that
  actually ran — important across the Wait boundary).
- **Overridden** → **Log Override** records that the recruiter overrode the recommendation.

Both converge into **Decision → JSON** (serialize) → **Write Decision Log** (writes
`files/decision_<email>_<timestamp>.json`). Every run — approved or overridden — leaves an
audit trail. In production these two nodes become a Google Sheets append or a Gmail send; the
HITL gate already protects the send.

## Data-preservation trick

Because n8n nodes pass their *own* output downstream, later nodes pull earlier data explicitly
via `$('NodeName').item.json`. This is how the score survives the AI drafting step and how the
final record reconstructs everything after the human approval pause.
