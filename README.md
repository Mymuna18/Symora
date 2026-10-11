# Symora

### Giving Every Patient a Voice, in Every Language

**Symora** is a multilingual, voice-first symptom reporting platform designed to make communication between clinical trial participants and research coordinators more accessible, structured, and understandable.

Built at **HackRU 2026**, Symora helps participants describe symptoms in their preferred language, uses AI to organize that information into structured English reports, and gives research teams a dashboard to review submissions and manage follow-ups.

**Live Website:** https://symora-one.vercel.app

**Interactive Demo:** https://symora-one.vercel.app/demo

> **Note:** The public Demo Mode is a simulated, browser-only experience. The authenticated application uses the real ElevenLabs, Gemini, and TigerData integrations.

---

## The Problem

Clinical trials depend on accurate symptom reporting. However, participants who are not fluent in English may struggle to communicate side effects, symptoms, and changes in their health.

Traditional reporting methods can create language barriers, introduce misunderstandings, and make communication with research teams more difficult.

We wanted to answer one question:

**What if patients could report how they feel simply by speaking their own language?**

## Our Solution

Symora provides a voice-first reporting experience that helps bridge the communication gap between participants and clinical trial coordinators.

Participants can speak or type a symptom description, review the transcription, and confirm a structured report before submission.

Research coordinators can then review reports through a centralized dashboard.

The goal is not to replace medical professionals, but to make symptom communication more accessible and easier to review.

## Key Features

### 1. Multilingual Voice Reporting

- Participants can record symptoms using their microphone.
- ElevenLabs Speech-to-Text transcribes the recorded audio.
- Participants can review and edit the transcript before proceeding.
- Spanish and Vietnamese are supported in our primary demonstration workflow.
- The application also includes English and Mandarin language options, with language-specific functionality requiring further validation.

### 2. AI-Powered Symptom Analysis

Google Gemini processes the participant-confirmed transcript and generates a structured English report.

The analysis includes:

- English translation and summary
- Identified symptoms
- Reported symptom onset
- Reported intensity, when explicitly provided
- Original-language source excerpts
- Clarification questions when appropriate

Symora is designed to avoid guessing missing medical details. Information that was not explicitly stated remains unspecified, and source excerpts are checked against the original transcript.

### 3. Participant Review and Confirmation

Before submission, participants can:

- Correct transcription errors
- Review extracted symptoms
- Examine the original supporting statements
- Resolve symptom mappings
- Confirm the final report

The participant remains involved in validating the information being submitted.

### 4. TigerData Database Integration

The authenticated reporting workflow uses TigerData, powered by PostgreSQL, to store and retrieve structured clinical trial symptom reports.

The backend supports participant-associated reports, symptom records, workflow status tracking, and coordinator review history.

### 5. Coordinator Dashboard

Clinical trial coordinators have a dedicated dashboard where they can:

- View submitted symptom reports
- Review participant-reported information
- Mark reports as reviewed
- Request follow-up
- Track report workflow statuses

### 6. Participant Notifications

Participants can receive in-app updates when their report has been reviewed or when a coordinator requests follow-up.

The application also supports recording participant responses to follow-up requests.

### 7. Public Demo Mode

Symora includes a separate interactive demo at `/demo`.

Visitors can explore a fictional participant-to-coordinator workflow without signing in.

**Demo Mode uses simulated analysis and browser localStorage. It does not call Gemini, ElevenLabs, protected APIs, or TigerData.**

---

## How Symora Works

**Step 1 — Speak**

A participant chooses their language and records a fictional symptom description.

**Step 2 — Transcribe**

ElevenLabs converts the recorded speech into editable text.

**Step 3 — Confirm**

The participant reviews the original-language transcript before analysis.

**Step 4 — Analyze**

Gemini generates a structured English symptom report with supporting excerpts and unspecified fields for missing information.

**Step 5 — Review and Submit**

The participant reviews the structured report and explicitly confirms it.

**Step 6 — Store**

The authenticated backend saves the submitted report in TigerData.

**Step 7 — Coordinator Review**

A coordinator can retrieve reports, review the details, and request follow-up when appropriate.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 16 | Full-stack web framework |
| React 19 | Participant and coordinator interfaces |
| TypeScript | Type-safe application development |
| Tailwind CSS | Responsive UI styling |
| ElevenLabs | Speech-to-text transcription |
| Google Gemini | Multilingual translation and structured symptom analysis |
| TigerData / PostgreSQL | Persistent report storage |
| Vercel | Application hosting and deployment |
| GitHub | Version control and team collaboration |

## Getting Started

### Prerequisites

You will need:

- Node.js compatible with Next.js 16
- npm
- Git
- A Gemini API key for AI analysis
- An ElevenLabs API key for voice transcription
- A PostgreSQL/TigerData database for persistent reporting
- Configured fictional participant and coordinator accounts for the authenticated workflow

### 1. Clone the Repository

```bash
git clone https://github.com/Mymuna18/Symora.git
cd Symora
npm install --no-audit --no-fund
```

### 2. Configure Environment Variables

Create your local environment file:

```bash
cp .env.example .env.local
```

Add the necessary private configuration:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-flash-latest

ELEVENLABS_API_KEY=your_elevenlabs_api_key

DATABASE_URL=your_postgresql_connection_string

SYMORA_BROWSER_AUTH_ENABLED=true
SYMORA_BROWSER_AUTH_ORIGIN=http://localhost:3000
SYMORA_BROWSER_SESSION_KEY=your_generated_session_key
SYMORA_BROWSER_ACCOUNTS=your_generated_accounts_json
```

The model name must be supported by your Gemini account. These values are illustrative placeholders, not working credentials.

Browser session keys and account records must be generated using the project's secure provisioning workflow. Valid fictional participant identities must already exist in the database.

See [Browser Authentication Documentation](docs/browser-auth-integration.md) for provisioning instructions.

**Never commit `.env.local`, API keys, database credentials, or account passwords.**

### 3. Configure the Database

The database schema and migration scripts are included in `db/migrations/` and `scripts/`.

Read the [TigerData Migration Documentation](docs/tigerdata-migration.md) before initializing a database.

Database migrations require explicit approval and should not be rerun against an already configured database.

### 4. Start the Development Server

```bash
npm run dev -- --hostname localhost
```

Open:

http://localhost:3000

Use `localhost` consistently if your authentication origin is set to `http://localhost:3000`.

### 5. Explore the Application

| Route | Description |
|---|---|
| `/` | Symora homepage |
| `/demo` | Public simulated demo |
| `/participant-login` | Participant authentication |
| `/report` | Authenticated symptom reporting portal |
| `/coordinator-login` | Coordinator authentication |
| `/dashboard` | Authenticated coordinator dashboard |
| `/recorder-test` | Standalone voice recorder test |

The authenticated pages require correctly configured accounts, database access, and server-side environment variables.

The public `/demo` route can be explored independently.

## Development Checks

Run linting:

```bash
npm run lint
```

Run the TypeScript check:

```bash
npx tsc --noEmit
```

Create a production build:

```bash
npm run build
```

Automated test coverage is also included in the `tests/` directory, covering reporting, authentication, coordinator workflows, notifications, and demo functionality.

## Privacy and Safety

Symora is a **hackathon prototype**, not a certified medical device or production clinical system.

Our approach emphasizes:

- Keeping original participant statements available for review
- Requiring participant confirmation before report submission
- Flagging unsupported source excerpts for review
- Leaving unspecified details empty rather than inventing values
- Protecting authenticated routes with role-based access controls
- Keeping API keys and database credentials server-side
- Using fictional participant information for demonstration purposes

These measures do not guarantee clinical accuracy or regulatory compliance.

**Symora does not provide medical diagnoses, treatment recommendations, or emergency medical services.**

The project is not represented as HIPAA compliant. Real-world deployment would require additional security, privacy, clinical validation, regulatory review, and reliability testing.

## Challenges and Future Improvements

Throughout development, we worked on integrating multilingual audio transcription, structured AI analysis, authenticated report submission, and database-backed coordinator workflows.

Some challenges included AI provider timeouts, deployment configuration, authentication setup, and coordinating separate frontend and backend features.

Future improvements include:

- More reliable AI request recovery and fallback handling
- Expanded and validated multilingual support
- Better accessibility and mobile experiences
- Improved coordinator reporting and analytics
- More robust notification and follow-up workflows
- Clinical usability testing with appropriate research stakeholders
- Comprehensive privacy, security, and compliance evaluations

## Our Team

Built collaboratively at **HackRU 2026**.

| Team Member | Primary Focus |
|---|---|
| Muna | Gemini integration and AI analysis |
| Anna | ElevenLabs and voice transcription |
| Elvin | TigerData, PostgreSQL, backend integration |
| Shrinika | Frontend UI/UX and application workflows |

## Our Mission

**Language should never prevent someone from being heard.**

Symora aims to make clinical trial symptom reporting more inclusive by connecting multilingual participant communication with structured, reviewable information for research teams.

*Built with Next.js, ElevenLabs, Google Gemini, and TigerData at HackRU 2026.*
