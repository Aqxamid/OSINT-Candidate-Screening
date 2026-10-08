# OSINT Vetting Scanner

Scanning engine for the OSINT Candidate Screening Platform. It runs [Maigret](https://github.com/soxoj/maigret) against
candidate handles and saves an HTML + JSON report per candidate.

> **Most people should use the web dashboard** in `../backend` (see the root README); it launches
> `scan_worker.py` for you. This folder also contains an optional **desktop GUI** and a **CLI** for
> working from an exported CSV without the backend.

**Requirements:** Python 3.9+ (Tkinter is bundled with Python on Windows/macOS; Linux needs `python3-tk`).

## Files in this folder

| File | Purpose | You add it? |
|------|---------|-------------|
| `scan_worker.py` | Worker launched by the web dashboard (NDJSON output) | Included |
| `gui_app.py` | Optional desktop GUI | Included |
| `scanner_core.py` | Shared scan engine (GUI + CLI) | Included |
| `batch_maigret.py` | Command-line scanner | Included |
| `requirements.txt` | `maigret`, `colorama` | Included |
| `run_gui.bat` / `run_gui.sh` | One-click launchers | Included |
| `.venv/` | Virtual environment | `npm run setup:scanner` (from `backend/`) or the launcher |
| `reports/` | Output | Auto-created |

## Launch the desktop GUI

**Windows:** double-click `run_gui.bat`

**Linux / macOS:**

```bash
./run_gui.sh        # Linux first time: sudo apt install python3-tk
```

### Manual setup (instead of the launcher)

**Windows (PowerShell):**

```powershell
cd osint-scanner
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python gui_app.py
```

> If PowerShell blocks `Activate.ps1`, run once:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Linux / macOS:**

```bash
cd osint-scanner
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python gui_app.py
```

## Using the GUI

**Scan tab**

1. **Get the CSV:** enter the backend URL (default `http://localhost:5000`) and the admin token, then
   **Download from backend**. Or **Browse...** to select an existing CSV.
2. **Review candidates:** every row shows its status. *Skip: ...* rows won't be scanned
   (invalid handle format or duplicate ID). *Report exists* rows are skipped unless
   you tick **Force rescan**.
3. **Scan:** set *Top sites* (default 200) and *Timeout per candidate* (default 15 min), then **Start scan**.
   A progress bar and live log show what's happening. **Stop** cancels the current scan and discards its
   partial output, so re-running resumes cleanly.
4. **Open reports:** double-click a row or use **Open selected report**. **Open reports folder** opens `reports/`.

The admin token is held in memory only and is never written to disk.

**Setup & Files tab**

- Environment checks: Python version, Tkinter, Maigret (including required flags), reports folder.
- A live list of every project file with **Found / Missing** status.

## Command-line usage

```bash
python batch_maigret.py --check                  # environment check
python batch_maigret.py candidates.csv
python batch_maigret.py candidates.csv --force   # rescan existing reports
python batch_maigret.py candidates.csv --top-sites 100 --timeout 10
```

To download the CSV from the backend manually:

```powershell
# Windows PowerShell
$env:ADMIN_API_KEY = "<your-admin-api-key>"
Invoke-RestMethod -Uri "http://localhost:5000/api/admin/osint/export-csv" `
  -Headers @{ "Authorization" = "Bearer $env:ADMIN_API_KEY" } `
  -OutFile "candidates.csv"
```

```bash
# Linux / macOS
export ADMIN_API_KEY="<your-admin-api-key>"
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
     -o "candidates_$(date +%F).csv" \
     http://localhost:5000/api/admin/osint/export-csv
```

## Input CSV format

The scanner accepts any CSV with at minimum a `Full_Name` column:

```csv
ID,Full_Name,Target_Handle
1,Maria Santos,mariasantos
2,David Reyes,
3,Sarah Connor,@sarah_c
```

- **`ID`** — optional; auto-assigned (row number) if missing or blank.
- **`Full_Name`** — required. Also accepts separate `First_Name` / `Last_Name` columns.
- **`Target_Handle`** — optional. Profile URLs are stripped automatically (`https://github.com/user` → `user`). If blank, a handle is derived from the candidate's first + last name (e.g. `mariasantos`).

## Output

| Item | Location |
|------|----------|
| Per-candidate report | `reports/applicant_<ID>/` (HTML dossier + simple JSON) |
| Run summary | `reports/summary_<timestamp>.csv` (ID, name, handle, status, detail, accounts found) |

CLI exit codes: `0` OK, `1` setup error, `2` some scans failed, `130` interrupted.

Statuses: `success`, `cached` (report already existed), `failed`, `skipped`, `cancelled`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Maigret "Not found" | `pip install -r requirements.txt` in the active venv, or use the launcher |
| "lacks flag(s)" | `pip install -U maigret` |
| `No module named tkinter` | Linux: `sudo apt install python3-tk` |
| Download: HTTP 403 | Token differs from `ADMIN_API_KEY` in `backend/.env` |
| Download: cannot reach backend | Start it with `npm start` in `backend/` |
| Candidates all skipped | Handle format is invalid (must be alphanumeric, `.`, `_`, `-`); check for duplicate IDs |

## Responsible use

- **Disclose and get consent.** Tell candidates that their submitted handle may be reviewed.
- **Handle matches are not identity proof.** A human must verify a profile belongs to the candidate before relying on it. The "Accounts found" number is approximate.
- **Review fairly.** Set criteria in advance; ignore protected or irrelevant traits (religion, orientation, politics, health).
- **Limit access and retention.** Restrict `reports/` to the vetting panel; delete it after decisions are final. Never commit `reports/` or CSVs.
- **Scope.** Only scan handles candidates supplied themselves. The GUI asks you to confirm this before the first scan.
