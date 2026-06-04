// Builds the n8n workflow JSON for the JD<->Resume Fit Analyzer + Interview Kit agent.
// Run: node build_workflow.js  -> writes workflow/jd-resume-fit-analyzer.json
const fs = require('fs');
const path = require('path');

const MODEL_CRED = { groqApi: { id: 'GROQ_CRED', name: 'Groq account' } };

// Retry-on-fail with backoff: absorbs any transient free-tier 429 rate limit between sequential AI calls.
const AI_RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 8000 };

// ---- AI prompts -----------------------------------------------------------
const INTERVIEW_KIT_PROMPT =
`You are a senior technical interviewer. A candidate has been assessed as a STRONG fit (score {{ $json.fit_score }}/100) for the role "{{ $json.role_title }}".

Candidate: {{ $json.candidate_name }}
Matched required skills: {{ $json.matched_must_have.join(', ') || 'n/a' }}
Missing required skills: {{ $json.missing_must_have.join(', ') || 'none' }}
Resume summary: {{ $json.resume_summary }}

Write a concise interview kit in Markdown with:
1. 3-4 focus areas tailored to verify their strengths and probe any gaps.
2. Exactly 5 specific interview questions, each followed by one italic line on what it assesses.
3. A one-line recommendation for the recruiter.
Keep it under 250 words. Output Markdown only, no preamble.`;

const GAP_ANALYSIS_PROMPT =
`You are a recruiting analyst. A candidate is a BORDERLINE fit (score {{ $json.fit_score }}/100) for "{{ $json.role_title }}".
Matched required skills: {{ $json.matched_must_have.join(', ') || 'none' }}
Missing required skills: {{ $json.missing_must_have.join(', ') || 'none' }}
Experience: {{ $json.candidate_years }} yrs vs required {{ $json.required_years }} yrs.

Write a short Markdown briefing for the recruiter with:
1. The 2-3 key gaps that create the risk.
2. Exactly 3 targeted screening questions to resolve the uncertainty before advancing.
3. A clear recommendation in bold: **ADVANCE TO SCREEN** or **HOLD**, with one line of reasoning.
Under 200 words. Markdown only, no preamble.`;

const REJECTION_PROMPT =
`You are a kind, professional recruiter. A candidate ({{ $json.candidate_name }}) is not a fit (score {{ $json.fit_score }}/100) for "{{ $json.role_title }}". Missing key skills: {{ $json.missing_must_have.join(', ') || 'core requirements' }}.

Write a warm, respectful rejection email body (Markdown) that:
- Greets them by name.
- Does NOT reveal the internal score or the word "score".
- Gently notes the gap in general, encouraging terms and invites future applications.
Keep it under 150 words. Output the email body only, no subject line, no preamble.`;

// ---- Code node bodies -----------------------------------------------------
const VALIDATE_CODE =
`// Deterministic input guard: reject empty / too-short submissions before spending any AI calls.
const item = $input.first().json;
const resume = (item['Resume Text'] || '').trim();
const jd = (item['Job Description'] || '').trim();
const email = (item['Candidate Email'] || '').trim();

const errors = [];
if (resume.length < 80) errors.push('Resume Text is too short (minimum 80 characters).');
if (jd.length < 80) errors.push('Job Description is too short (minimum 80 characters).');
if (!email.includes('@')) errors.push('Candidate Email looks invalid.');

return [{ json: { ...item, _valid: errors.length === 0, _errors: errors } }];`;

const COMPUTE_FIT_CODE =
`// DETERMINISTIC fit scoring. No AI here - pure, auditable math over the AI-extracted fields.
function ex(nodeName) {
  const j = $(nodeName).item.json;
  return j.output || j; // tolerate parser wrapping
}
const resume = ex('Resume Extractor');
const jd = ex('JD Extractor');
const form = $('Intake Form').item.json;

const norm = s => String(s || '').toLowerCase().trim();
const resumeSkills = (resume.skills || []).map(norm).filter(Boolean);
const must = (jd.must_have_skills || []).map(norm).filter(Boolean);
const nice = (jd.nice_to_have_skills || []).map(norm).filter(Boolean);

// fuzzy contains so "react.js" matches "react"
const has = sk => resumeSkills.some(r => r.includes(sk) || sk.includes(r));
const matchedMust = must.filter(has);
const missingMust = must.filter(s => !has(s));
const matchedNice = nice.filter(has);

const mustScore = must.length ? (matchedMust.length / must.length) * 70 : 50;
const niceScore = nice.length ? (matchedNice.length / nice.length) * 15 : 7.5;

const minYears = Number(jd.min_years_experience || 0);
const years = Number(resume.years_experience || 0);
let expScore;
if (minYears <= 0) expScore = 12;
else if (years >= minYears) expScore = 15;
else expScore = Math.max(0, (years / minYears) * 15);

const fit_score = Math.round(Math.min(100, mustScore + niceScore + expScore));
let band;
if (fit_score >= 75) band = 'STRONG';
else if (fit_score >= 50) band = 'MAYBE';
else band = 'WEAK';

return [{ json: {
  candidate_name: form['Candidate Name'],
  candidate_email: form['Candidate Email'],
  role_title: form['Role Title'],
  fit_score,
  band,
  matched_must_have: matchedMust,
  missing_must_have: missingMust,
  matched_nice_to_have: matchedNice,
  candidate_years: years,
  required_years: minYears,
  resume_summary: resume.summary || resume.current_title || '',
  resume_skills: resumeSkills,
  must_have_skills: must,
} }];`;

const FINALIZE_CODE =
`// Recruiter APPROVED. Assemble the final, auditable decision record + the message to send.
const fit = $('Compute Fit Score').item.json;
const approval = $('Recruiter Approval').item.json;
const band = fit.band;

let draft = '', action = '';
if (band === 'STRONG') { draft = $('Interview Kit Writer').item.json.text; action = 'INTERVIEW_INVITE'; }
else if (band === 'MAYBE') { draft = $('Gap Analysis Writer').item.json.text; action = 'ADVANCE_TO_SCREEN'; }
else { draft = $('Rejection Writer').item.json.text; action = 'SEND_REJECTION'; }

return [{ json: {
  status: 'APPROVED',
  candidate_name: fit.candidate_name,
  candidate_email: fit.candidate_email,
  role_title: fit.role_title,
  fit_score: fit.fit_score,
  band: fit.band,
  action_taken: action,
  recruiter_decision: approval.Decision,
  recruiter_notes: approval['Recruiter Notes'] || '',
  matched_must_have: fit.matched_must_have,
  missing_must_have: fit.missing_must_have,
  final_message: draft,
  logged_at: new Date().toISOString(),
} }];`;

const OVERRIDE_CODE =
`// Recruiter OVERRODE the AI recommendation. Log the override (this is the human-in-the-loop safety net).
const fit = $('Compute Fit Score').item.json;
const approval = $('Recruiter Approval').item.json;

return [{ json: {
  status: 'RECRUITER_OVERRIDE',
  candidate_name: fit.candidate_name,
  candidate_email: fit.candidate_email,
  role_title: fit.role_title,
  fit_score: fit.fit_score,
  band: fit.band,
  action_taken: 'DISCARDED_BY_RECRUITER',
  recruiter_decision: approval.Decision,
  recruiter_notes: approval['Recruiter Notes'] || '',
  logged_at: new Date().toISOString(),
} }];`;

// ---- helpers --------------------------------------------------------------
let _id = 0;
const uid = () => `node-${String(++_id).padStart(4, '0')}`;

function filter(left, op, right, type = 'string') {
  const operator = { type, operation: op };
  if (op === 'true' || op === 'false' || op === 'empty' || op === 'notEmpty') operator.singleValue = true;
  const cond = { id: uid(), leftValue: left, rightValue: right === undefined ? '' : right, operator };
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [cond],
    combinator: 'and',
  };
}

const nodes = [];
function add(name, type, typeVersion, position, parameters, extra = {}) {
  const node = { parameters, id: uid(), name, type, typeVersion, position, ...extra };
  nodes.push(node);
  return name;
}

// ---- nodes ----------------------------------------------------------------
add('Intake Form', 'n8n-nodes-base.formTrigger', 2.2, [-560, 0], {
  path: 'candidate-intake',
  formTitle: 'Candidate Screening Intake',
  formDescription: 'Paste a candidate resume and the job description. The agent scores fit, routes the candidate, and drafts the next action for recruiter approval.',
  formFields: { values: [
    { fieldLabel: 'Candidate Name', fieldType: 'text', requiredField: true },
    { fieldLabel: 'Candidate Email', fieldType: 'email', requiredField: true },
    { fieldLabel: 'Role Title', fieldType: 'text', requiredField: true },
    { fieldLabel: 'Resume Text', fieldType: 'textarea', requiredField: true },
    { fieldLabel: 'Job Description', fieldType: 'textarea', requiredField: true },
  ] },
  responseMode: 'onReceived',
  options: {},
}, { webhookId: 'candidate-intake' });

add('Validate Input', 'n8n-nodes-base.code', 2, [-340, 0], { language: 'javaScript', jsCode: VALIDATE_CODE });

add('Valid?', 'n8n-nodes-base.if', 2.2, [-120, 0], { conditions: filter('={{ $json._valid }}', 'true', undefined, 'boolean'), options: {} });

add('Fallback: Request Resubmit', 'n8n-nodes-base.set', 3.4, [100, 220], {
  assignments: { assignments: [
    { id: uid(), name: 'status', value: 'INVALID_INPUT', type: 'string' },
    { id: uid(), name: 'message', value: '={{ $json._errors.join(" ") }}', type: 'string' },
  ] },
  options: {},
});

add('Resume Extractor', '@n8n/n8n-nodes-langchain.informationExtractor', 1.2, [100, -120], {
  text: "={{ $('Intake Form').item.json['Resume Text'] }}",
  schemaType: 'fromJson',
  jsonSchemaExample: JSON.stringify({
    skills: ['python', 'react', 'aws'],
    years_experience: 4,
    highest_education: 'B.Tech Computer Science',
    current_title: 'Software Engineer',
    summary: 'Full-stack engineer with fintech experience.',
  }, null, 2),
  options: {},
}, AI_RETRY);

add('JD Extractor', '@n8n/n8n-nodes-langchain.informationExtractor', 1.2, [320, -120], {
  text: "={{ $('Intake Form').item.json['Job Description'] }}",
  schemaType: 'fromJson',
  jsonSchemaExample: JSON.stringify({
    must_have_skills: ['python', 'kubernetes'],
    nice_to_have_skills: ['terraform'],
    min_years_experience: 3,
    seniority: 'mid',
  }, null, 2),
  options: {},
}, AI_RETRY);

add('Compute Fit Score', 'n8n-nodes-base.code', 2, [540, -120], { language: 'javaScript', jsCode: COMPUTE_FIT_CODE });

// Router: 3 deterministic bands
add('Route by Fit Band', 'n8n-nodes-base.switch', 3.2, [760, -120], {
  rules: { values: [
    { conditions: filter('={{ $json.band }}', 'equals', 'STRONG'), renameOutput: true, outputKey: 'Strong (>=75)' },
    { conditions: filter('={{ $json.band }}', 'equals', 'MAYBE'), renameOutput: true, outputKey: 'Maybe (50-74)' },
    { conditions: filter('={{ $json.band }}', 'equals', 'WEAK'), renameOutput: true, outputKey: 'Weak (<50)' },
  ] },
  options: {},
});

// Shared model (Groq free tier — generous rate limits, OpenAI-compatible)
add('Groq Llama 3.3 70B', '@n8n/n8n-nodes-langchain.lmChatGroq', 1, [540, 200], {
  model: 'llama-3.3-70b-versatile',
  options: {},
}, { credentials: MODEL_CRED });

// Generators (one per band)
// NOTE: prompts are prefixed with '=' so n8n evaluates the {{ }} expressions before sending to the LLM.
add('Interview Kit Writer', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [1000, -320], { promptType: 'define', text: '=' + INTERVIEW_KIT_PROMPT }, AI_RETRY);
add('Gap Analysis Writer', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [1000, -120], { promptType: 'define', text: '=' + GAP_ANALYSIS_PROMPT }, AI_RETRY);
add('Rejection Writer', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [1000, 120], { promptType: 'define', text: '=' + REJECTION_PROMPT }, AI_RETRY);

// Shape each branch into a common {action_type, draft, ...} item for the approval form
function shape(name, pos, actionType) {
  add(name, 'n8n-nodes-base.set', 3.4, pos, {
    assignments: { assignments: [
      { id: uid(), name: 'action_type', value: actionType, type: 'string' },
      { id: uid(), name: 'draft', value: '={{ $json.text }}', type: 'string' },
      { id: uid(), name: 'candidate_name', value: "={{ $('Compute Fit Score').item.json.candidate_name }}", type: 'string' },
      { id: uid(), name: 'role_title', value: "={{ $('Compute Fit Score').item.json.role_title }}", type: 'string' },
      { id: uid(), name: 'fit_score', value: "={{ $('Compute Fit Score').item.json.fit_score }}", type: 'number' },
      { id: uid(), name: 'band', value: "={{ $('Compute Fit Score').item.json.band }}", type: 'string' },
    ] },
    options: {},
  });
}
shape('Shape: Interview', [1220, -320], 'INTERVIEW_INVITE');
shape('Shape: Screen', [1220, -120], 'ADVANCE_TO_SCREEN');
shape('Shape: Reject', [1220, 120], 'SEND_REJECTION');

// Human-in-the-loop approval (Wait node, resumes on form submit)
add('Recruiter Approval', 'n8n-nodes-base.wait', 1.1, [1460, -120], {
  resume: 'form',
  formTitle: 'Recruiter Approval Required',
  formDescription: '={{ $json.candidate_name }} — {{ $json.role_title }}  |  Fit {{ $json.fit_score }}/100 ({{ $json.band }})  |  Proposed: {{ $json.action_type }}\n\n----- AI DRAFT (review before approving) -----\n\n{{ $json.draft }}',
  formFields: { values: [
    { fieldLabel: 'Decision', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [
      { option: 'APPROVE - proceed with this action' },
      { option: 'REJECT - override and discard' },
    ] } },
    { fieldLabel: 'Recruiter Notes', fieldType: 'textarea', requiredField: false },
  ] },
  options: {},
}, { webhookId: 'recruiter-approval' });

// Decision gate on the human's choice
add('Approval Decision', 'n8n-nodes-base.switch', 3.2, [1680, -120], {
  rules: { values: [
    { conditions: filter('={{ $json.Decision }}', 'contains', 'APPROVE'), renameOutput: true, outputKey: 'Approved' },
    { conditions: filter('={{ $json.Decision }}', 'contains', 'REJECT'), renameOutput: true, outputKey: 'Overridden' },
  ] },
  options: { fallbackOutput: 'extra' },
});

add('Finalize Record', 'n8n-nodes-base.code', 2, [1900, -240], { language: 'javaScript', jsCode: FINALIZE_CODE });
add('Log Override', 'n8n-nodes-base.code', 2, [1900, 20], { language: 'javaScript', jsCode: OVERRIDE_CODE });

add('Decision -> JSON', 'n8n-nodes-base.convertToFile', 1.1, [2120, -120], {
  operation: 'toJson',
  options: { fileName: 'decision.json', format: true },
});

add('Write Decision Log', 'n8n-nodes-base.readWriteFile', 1.1, [2340, -120], {
  operation: 'write',
  fileName: "=/project/files/decision_{{ $('Compute Fit Score').item.json.candidate_email.split('@')[0] }}_{{ $now.toMillis() }}.json",
  dataPropertyName: 'data',
  options: {},
});

// ---- connections ----------------------------------------------------------
const connections = {};
function connect(from, to, type = 'main', outIndex = 0, inIndex = 0) {
  connections[from] = connections[from] || {};
  connections[from][type] = connections[from][type] || [];
  while (connections[from][type].length <= outIndex) connections[from][type].push([]);
  connections[from][type][outIndex].push({ node: to, type, index: inIndex });
}

connect('Intake Form', 'Validate Input');
connect('Validate Input', 'Valid?');
connect('Valid?', 'Resume Extractor', 'main', 0);            // true
connect('Valid?', 'Fallback: Request Resubmit', 'main', 1);  // false
connect('Resume Extractor', 'JD Extractor');
connect('JD Extractor', 'Compute Fit Score');
connect('Compute Fit Score', 'Route by Fit Band');
connect('Route by Fit Band', 'Interview Kit Writer', 'main', 0);
connect('Route by Fit Band', 'Gap Analysis Writer', 'main', 1);
connect('Route by Fit Band', 'Rejection Writer', 'main', 2);
connect('Interview Kit Writer', 'Shape: Interview');
connect('Gap Analysis Writer', 'Shape: Screen');
connect('Rejection Writer', 'Shape: Reject');
connect('Shape: Interview', 'Recruiter Approval');
connect('Shape: Screen', 'Recruiter Approval');
connect('Shape: Reject', 'Recruiter Approval');
connect('Recruiter Approval', 'Approval Decision');
connect('Approval Decision', 'Finalize Record', 'main', 0);
connect('Approval Decision', 'Log Override', 'main', 1);
connect('Finalize Record', 'Decision -> JSON');
connect('Log Override', 'Decision -> JSON');
connect('Decision -> JSON', 'Write Decision Log');

// ai_languageModel: one shared Gemini model feeds all 5 AI nodes
['Resume Extractor', 'JD Extractor', 'Interview Kit Writer', 'Gap Analysis Writer', 'Rejection Writer']
  .forEach(target => connect('Groq Llama 3.3 70B', target, 'ai_languageModel'));

const workflow = {
  id: 'jdResumeFitAgent1',
  name: 'JD↔Resume Fit Analyzer + Interview Kit (Agentic)',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = path.join(__dirname, 'workflow', 'jd-resume-fit-analyzer.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log('Wrote', out, '-', nodes.length, 'nodes');
