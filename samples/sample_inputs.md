# Sample Inputs

Paste these into the intake form (`http://localhost:5678/form/candidate-intake`) during the demo.
Each one deterministically lands in a different routing band, so you can show all three paths.

---

## Shared Job Description (use for all three candidates)

**Role Title:** `Senior Backend Engineer`

**Job Description:**
```
We are hiring a Senior Backend Engineer to own our payments platform.

Must-have skills: Python, PostgreSQL, Kubernetes, REST API design, AWS.
Nice-to-have: Terraform, Kafka, gRPC.
Minimum experience: 5 years building production backend systems.

You will design fault-tolerant services, own database schema design, and
mentor mid-level engineers. Strong system-design and on-call ownership expected.
```

---

## Candidate A — lands in STRONG (≈ interview kit)

- **Candidate Name:** `Priya Sharma`
- **Candidate Email:** `priya.sharma@example.com`

**Resume Text:**
```
Senior Software Engineer with 7 years of experience building backend payment systems.
Expert in Python and PostgreSQL. Designed and operated Kubernetes-based microservices on AWS,
including REST APIs handling 5k req/s. Introduced Terraform for infra-as-code and Kafka for
event streaming. Led on-call rotation and mentored 3 junior engineers.
B.Tech in Computer Science.
```

---

## Candidate B — lands in MAYBE (≈ gap analysis + screening questions)

- **Candidate Name:** `Arjun Mehta`
- **Candidate Email:** `arjun.mehta@example.com`

**Resume Text:**
```
Backend Engineer with 4 years of experience. Strong in Python and REST API design.
Worked with PostgreSQL for transactional systems. Some exposure to AWS (EC2, S3).
Have not used Kubernetes in production yet but completed a certification course.
B.E. in Information Technology.
```

---

## Candidate C — lands in WEAK (≈ polite rejection draft)

- **Candidate Name:** `Sam Lee`
- **Candidate Email:** `sam.lee@example.com`

**Resume Text:**
```
Frontend Developer with 2 years of experience. Skilled in React, TypeScript, HTML and CSS.
Built responsive dashboards and design systems. Familiar with Figma and basic Node.js.
Interested in moving toward full-stack work. B.Des in Interaction Design.
```

---

## Fallback test (deterministic guard, no AI spent)

Submit with **Resume Text** = `hi` (under 80 chars). The workflow stops at the
`Valid?` gate and routes to **Fallback: Request Resubmit** — no AI calls are made.
