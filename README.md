# OSINT Candidate Screening Platform

A modern, professional platform for recruitment and vetting teams to audit the public online footprint of candidates using open-source intelligence (OSINT).

Built with an **Express (Node.js)** backend, a **React & Shadcn UI** web dashboard, and a **Python (Maigret)** scanning worker.

---

## Key Features

- **Automated OSINT Reconnaissance**: Runs multi-site profile queries across 200+ public platforms and databases.
- **Modern Shadcn UI Web Dashboard**: Built with React 18, Tailwind CSS, Lucide icons, dark mode, metrics cards, real-time log terminal, and an embedded sandboxed report viewer.
- **Flexible Data Ingestion**:
  - Direct PostgreSQL database integration.
  - Custom CSV file import (drag-and-drop or file upload).
  - Flexible column detection: accepts `Full Name` or separate `First Name` / `Last Name` columns.
  - Automatically sanitizes handles and strips profile URLs (e.g. `https://github.com/username` $\rightarrow$ `username`).
- **Smart Fallback Handle Generation**: If a candidate has no handle in the database or CSV, a clean fallback handle is automatically derived from their name (e.g., `"Maria Santos"` $\rightarrow$ `mariasantos`).
- **Live SSE Progress**: Real-time server-sent events (SSE) stream scan progress and live terminal output directly to the browser.
- **Privacy & Compliance**: Built-in consent verification checklist, sandboxed HTML report viewing, and one-click report deletion.

---

## Interfaces Available

| Interface | Best For | How to Launch |
|---|---|---|
| **Web Dashboard (Shadcn UI)** | Primary recruitment workflow, committee reviews | `npm start` in `backend/`, then open `http://localhost:5000/dashboard/` |
| **Desktop GUI (Tkinter)** | Standalone offline machine, loads local CSV | `osint-scanner/run_gui.bat` (Windows) or `run_gui.sh` (Linux/macOS) |
| **CLI Scanner** | Scripting, batch automation | `python osint-scanner/batch_maigret.py <file.csv>` |

---

## Architecture Overview

```text
Database (PostgreSQL) --+
                        |--> Express Backend --+--> Shadcn Web Dashboard (Browser)
CSV Upload (Drag & Drop)-+                      |      |
                                               |      v (launches worker)
                                               |   osint-scanner/scan_worker.py --> Maigret --> reports/applicant_<ID>/
                                               |
                                               +--> CSV Export --> Desktop GUI / CLI
```

---

## Quick Start

### Prerequisites
- **Node.js**: v18.17+
- **Python**: v3.9+
- **PostgreSQL**: v13+ (optional if using CSV import mode)

### 1. Setup Backend & Scanner

```bash
cd backend
npm install
npm run setup:scanner    # Creates osint-scanner/.venv and installs requirements
```

### 2. Configure Environment

Copy `.env.example` to `.env` inside `backend/`:
```bash
cp .env.example .env    # Windows: copy .env.example .env
```

Set the following values in `backend/.env`:
```ini
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@localhost:5432/recruitment_db
ADMIN_API_KEY=your_secure_random_admin_api_key_32_characters_minimum
```

### 3. Build & Run

To build the Shadcn UI frontend and launch the server:
```bash
# Build the React/Shadcn dashboard into backend/public
npm run build:ui

# Start the server
npm start
```

Open **[http://localhost:5000/dashboard/](http://localhost:5000/dashboard/)** in your browser and log in using your `ADMIN_API_KEY`.

---

## CSV Ingestion Format

The platform accepts CSV files with any standard column structure:

```csv
Full Name,Target Handle
Maria Santos,https://github.com/mariasantos
David Reyes,
Sarah Connor,@sarah_c
```

Or with separated name columns:

```csv
First Name,Last Name,Username
Maria,Santos,mariasantos
David,Reyes,
```

- **Missing Handle Fallback**: If `Target Handle` is blank, the system automatically derives `first + last` name (e.g. `davidreyes`) so every candidate is scannable.
- **URL Stripping**: Pasted URLs like `https://instagram.com/user` or `@user` are cleaned automatically to `user`.

---

## Frontend Development

To run the React & Tailwind frontend with hot-module replacement (HMR):

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs at `http://localhost:5173/dashboard/` and proxies API requests to `http://localhost:5000`.

---

## Security & Ethics

1. **Candidate Consent**: Vetting must be conducted with candidate disclosure. Confirm the verification checklist prior to scanning.
2. **Identity Verification**: Handle matches across third-party websites do not establish confirmed identity. All profile findings require manual human verification before making hiring or vetting decisions.
3. **Data Retention**: Scan reports are stored locally in `osint-scanner/reports/`. Use the **Delete all** action in the dashboard to remove stored dossier reports once decisions are finalized.
