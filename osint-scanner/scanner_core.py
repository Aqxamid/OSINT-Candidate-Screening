"""Shared scanning engine for the PCS OSINT scanner (used by the CLI and the GUI)."""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, List, Optional, Tuple

APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent
OUTPUT_DIR = APP_DIR / "reports"

REQUIRED_COLUMNS = ("Full_Name",)
DEFAULT_TOP_SITES = 200
DEFAULT_TIMEOUT_MINUTES = 15

# Handles become CLI arguments: restrict charset and forbid a leading "-" (option injection).
HANDLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

REQUIRED_FLAGS = ("--top-sites", "--html", "--json", "-fo")
OPTIONAL_FLAGS = ("--no-progressbar", "--no-color")

def expected_files() -> List[Tuple[str, str, str, str]]:
    """(path, purpose, group, provider) rows from project-files.json at the project root."""
    try:
        data = json.loads((PROJECT_ROOT / "project-files.json").read_text(encoding="utf-8"))
        return [(d["path"], d["purpose"], d["group"], d["provider"]) for d in data]
    except (OSError, ValueError, KeyError):
        return []


# ----------------------------------------------------------------- data model
@dataclass
class Applicant:
    row: int
    id: str
    name: str
    handle: str
    division: str = ""
    problem: Optional[str] = None


@dataclass
class Result:
    applicant: Applicant
    status: str
    detail: str = ""
    found: Optional[int] = None


def validate(a: Applicant) -> Optional[str]:
    if not ID_RE.match(a.id):
        return "invalid or missing ID"
    if not a.handle:
        return "no handle provided"
    if not HANDLE_RE.match(a.handle):
        return "invalid handle format"
    return None


def _clean(value) -> str:
    """Trim a cell and undo the backend's CSV formula-injection guard (a leading apostrophe
    added before = + - @), so "'@ana" becomes "@ana"."""
    v = (value or "").strip()
    if len(v) > 1 and v[0] == "'" and v[1] in "=+-@":
        v = v[1:]
    return v

def _clean_handle(value: str) -> str:
    """Extract raw username from URL or handle string."""
    h = _clean(value)
    # Strip URL prefixes
    h = re.sub(r"^https?://[^/]+/", "", h, flags=re.IGNORECASE)
    h = re.sub(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/", "", h, flags=re.IGNORECASE)
    h = h.split("?")[0].split("#")[0].rstrip("/")
    h = h.lstrip("@/").strip()
    # Retain valid chars
    h = re.sub(r"[^A-Za-z0-9._-]", "", h)
    return h

def _generate_handles_from_name(full_name: str) -> List[str]:
    """Derive common username patterns from a full name (first + last or full name)."""
    clean = re.sub(r'[^a-zA-Z0-9\s]', '', full_name).lower()
    parts = clean.split()
    if not parts or full_name.lower() == "unknown":
        return []

    first = parts[0]
    last = parts[-1] if len(parts) > 1 else ""

    candidates = []
    if last:
        candidates.extend([
            f"{first}{last}",
            f"{first}_{last}",
            f"{first}.{last}",
            f"{first[0]}{last}",
        ])
    else:
        candidates.append(first)

    return candidates


def load_applicants(csv_path) -> List[Applicant]:
    path = Path(csv_path)
    if not path.is_file():
        raise FileNotFoundError(f"CSV file not found: {path}")
    applicants: List[Applicant] = []
    seen = set()
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        
        # Build normalized column map
        norm_map = {re.sub(r"[\s_\-./\\]+", "", f.lower()): f for f in fieldnames}
        
        def find_field(*keys):
            for k in keys:
                cleaned_k = re.sub(r"[\s_\-./\\]+", "", k.lower())
                if cleaned_k in norm_map:
                    return norm_map[cleaned_k]
            return None

        id_col = find_field("id", "applicant_id", "candidate_id", "number", "num", "no")
        name_col = find_field("full_name", "fullname", "name", "applicant_name", "candidate_name", "applicant")
        first_col = find_field("first_name", "firstname", "first", "given_name")
        last_col = find_field("last_name", "lastname", "last", "surname")
        handle_col = find_field("target_handle", "targethandle", "handle", "username", "socials", "github", "account")
        div_col = find_field("main_division", "division", "maindivision")

        for i, row in enumerate(reader):
            # Extract name
            name = ""
            if name_col and row.get(name_col):
                name = _clean(row[name_col])
            elif first_col or last_col:
                first = _clean(row.get(first_col, "")) if first_col else ""
                last = _clean(row.get(last_col, "")) if last_col else ""
                name = f"{first} {last}".strip()
            if not name:
                name = "Unknown"

            # Extract handle
            raw_handle = _clean_handle(row.get(handle_col, "")) if handle_col else ""

            # Fallback if handle missing: derive from name (first + last)
            if not raw_handle and name != "Unknown":
                candidates = _generate_handles_from_name(name)
                raw_handle = candidates[0] if candidates else ""

            # Extract or assign ID
            raw_id = _clean(row.get(id_col, "")) if id_col else ""
            if not raw_id or not ID_RE.match(raw_id):
                raw_id = str(i + 1)

            division = _clean(row.get(div_col, "")) if div_col else ""

            a = Applicant(
                row=i,
                id=raw_id,
                name=name,
                handle=raw_handle,
                division=division,
            )
            a.problem = validate(a)
            if a.problem is None and a.id in seen:
                a.problem = "duplicate ID"
            seen.add(a.id)
            applicants.append(a)
    return applicants


def find_latest_csv() -> Optional[Path]:
    candidates = []
    for base in (Path.cwd(), APP_DIR):
        candidates += list(base.glob("pcs_recruitment_osint*.csv"))
    return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None


# ----------------------------------------------------------------- maigret
_HELP_CACHE = {}


def _popen_kwargs() -> dict:
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if os.name == "nt" else {}


def _child_env() -> dict:
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def find_maigret() -> Optional[str]:
    exe = shutil.which("maigret")
    if exe:
        return exe
    name = "maigret.exe" if os.name == "nt" else "maigret"
    base = Path(sys.executable).parent
    for folder in (base, base / "Scripts", base / "bin"):
        cand = folder / name
        if cand.is_file():
            return str(cand)
    return None


def _module_available() -> bool:
    try:
        import importlib.util
        return importlib.util.find_spec("maigret") is not None
    except (ImportError, ValueError):
        return False


def find_maigret_cmd() -> Optional[List[str]]:
    """Command prefix used to run Maigret. Prefers `<this python> -m maigret` (same as running
    `python -m maigret` by hand, independent of PATH), then the maigret executable."""
    if _module_available():
        return [sys.executable, "-u", "-m", "maigret"]
    exe = find_maigret()
    return [exe] if exe else None


def maigret_help(cmd) -> str:
    cmd = [cmd] if isinstance(cmd, str) else list(cmd)
    key = tuple(cmd)
    if key not in _HELP_CACHE:
        r = subprocess.run(
            cmd + ["--help"], capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=120, env=_child_env(), **_popen_kwargs(),
        )
        _HELP_CACHE[key] = (r.stdout or "") + (r.stderr or "")
    return _HELP_CACHE[key]


def check_maigret() -> Tuple[bool, str]:
    cmd = find_maigret_cmd()
    if not cmd:
        return False, f"Not found for {sys.executable}. Run: {sys.executable} -m pip install -r requirements.txt"
    shown = " ".join(cmd)
    try:
        text = maigret_help(cmd)
    except Exception as e:  # noqa: BLE001
        return False, f"Found ({shown}) but could not run it: {e}"
    missing = [f for f in REQUIRED_FLAGS if f not in text]
    if missing:
        return False, f"Installed version lacks flag(s): {', '.join(missing)}. Try: pip install -U maigret"
    return True, shown


def environment_checks(include_gui: bool = True) -> List[Tuple[str, bool, str]]:
    out = []
    v = sys.version_info
    out.append(("Python 3.9+", v >= (3, 9), f"Python {v.major}.{v.minor}.{v.micro}"))
    if include_gui:
        try:
            import tkinter  # noqa: F401
            out.append(("Tkinter (GUI)", True, "available"))
        except ImportError:
            out.append(("Tkinter (GUI)", False, "Install python3-tk (Linux) or reinstall Python with Tcl/Tk"))
    ok, msg = check_maigret()
    out.append(("Maigret", ok, msg))
    try:
        OUTPUT_DIR.mkdir(exist_ok=True)
        probe = OUTPUT_DIR / ".write_test"
        probe.write_text("x")
        probe.unlink()
        out.append(("Reports folder writable", True, str(OUTPUT_DIR)))
    except OSError as e:
        out.append(("Reports folder writable", False, str(e)))
    return out


def file_status(pattern: str) -> bool:
    if "*" in pattern:
        return any(PROJECT_ROOT.glob(pattern))
    return (PROJECT_ROOT / pattern).exists()


# ----------------------------------------------------------------- reports
def report_dir(applicant_id: str) -> Path:
    return OUTPUT_DIR / f"applicant_{applicant_id}"


def has_report(folder: Path) -> bool:
    return folder.is_dir() and (any(folder.rglob("*.html")) or any(folder.rglob("*.json")))


def find_html(folder: Path) -> Optional[Path]:
    files = sorted(folder.rglob("*.html")) if folder.is_dir() else []
    return files[0] if files else None


def count_found(folder: Path) -> Optional[int]:
    """Approximate number of accounts in Maigret's simple JSON (None if unreadable)."""
    if not folder.is_dir():
        return None
    for p in folder.rglob("*.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            return sum(1 for v in data.values() if isinstance(v, dict))
        if isinstance(data, list):
            return len(data)
    return None


def open_in_file_manager(path) -> None:
    path = str(path)
    if sys.platform.startswith("win"):
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


# ----------------------------------------------------------------- scanning
class ScanController:
    """Runs Maigret subprocesses and supports cancelling from another thread."""

    def __init__(self) -> None:
        self._cancel = threading.Event()
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def cancel(self) -> None:
        self._cancel.set()
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                self._proc.terminate()

    def scan_handle(self, handle: str, out_dir: Path, top_sites: int,
                    timeout_minutes: int, log: Callable[[str], None]) -> Tuple[bool, str]:
        base_cmd = find_maigret_cmd()
        if not base_cmd:
            return False, "maigret not found"
        try:
            help_text = maigret_help(base_cmd)
        except Exception as e:  # noqa: BLE001
            return False, f"cannot run maigret: {e}"

        cmd = base_cmd + [handle, "--top-sites", str(top_sites), "--html", "--json", "simple", "-fo", str(out_dir)]
        cmd += [f for f in OPTIONAL_FLAGS if f in help_text]

        try:
            proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace", bufsize=1, env=_child_env(), **_popen_kwargs(),
            )
        except OSError as e:
            return False, str(e)

        with self._lock:
            self._proc = proc
        timed_out = []

        def _kill() -> None:
            timed_out.append(True)
            proc.kill()

        timer = threading.Timer(timeout_minutes * 60, _kill)
        timer.start()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    try:
                        log(line)
                    except Exception:
                        pass
            rc = proc.wait()
        finally:
            timer.cancel()
            with self._lock:
                self._proc = None

        if self.cancelled:
            return False, "cancelled"
        if timed_out:
            return False, f"timed out after {timeout_minutes} min"
        if rc != 0:
            return False, f"maigret exited with code {rc}"
        return True, "ok"


def write_summary(results: List[Result]) -> Path:
    OUTPUT_DIR.mkdir(exist_ok=True)
    path = OUTPUT_DIR / f"summary_{datetime.now():%Y-%m-%d_%H%M%S}.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ID", "Full_Name", "Handle", "Status", "Detail", "Accounts_Found"])
        for r in results:
            a = r.applicant
            w.writerow([a.id, a.name, a.handle, r.status, r.detail, "" if r.found is None else r.found])
    return path


def run_batch(
    applicants: List[Applicant],
    controller: ScanController,
    *,
    force: bool = False,
    top_sites: int = DEFAULT_TOP_SITES,
    timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES,
    log: Callable[[str], None] = print,
    on_status: Optional[Callable[[Applicant, str, str, Optional[int]], None]] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> Tuple[List[Result], Optional[Path]]:
    OUTPUT_DIR.mkdir(exist_ok=True)
    results: List[Result] = []
    total = len(applicants)

    def record(a: Applicant, status: str, detail: str = "", found: Optional[int] = None) -> None:
        results.append(Result(a, status, detail, found))
        if on_status:
            on_status(a, status, detail, found)

    for idx, a in enumerate(applicants, start=1):
        if controller.cancelled:
            break
        tag = f"({idx}/{total}) [{a.id or '?'}] {a.name}"

        if a.problem:
            log(f"[!] {tag}: skipped - {a.problem}")
            record(a, "skipped", a.problem)
        else:
            out_dir = report_dir(a.id)
            if has_report(out_dir) and not force:
                log(f"[i] {tag}: report exists, skipping (use Force rescan to redo)")
                record(a, "cached", "", count_found(out_dir))
            else:
                if out_dir.exists():
                    shutil.rmtree(out_dir, ignore_errors=True)
                out_dir.mkdir(parents=True, exist_ok=True)
                log(f"[+] {tag} (@{a.handle})")
                if on_status:
                    on_status(a, "scanning", "", None)
                ok, detail = controller.scan_handle(a.handle, out_dir, top_sites, timeout_minutes, log)
                if ok:
                    found = count_found(out_dir)
                    log(f"[OK] Report saved to {out_dir}")
                    record(a, "success", "", found)
                else:
                    shutil.rmtree(out_dir, ignore_errors=True)  # never leave partial reports behind
                    if detail == "cancelled":
                        log(f"[!] {tag}: cancelled")
                        record(a, "cancelled", detail)
                        break
                    log(f"[X] {tag}: scan failed - {detail}")
                    record(a, "failed", detail)

        if on_progress:
            on_progress(idx, total)

    summary = write_summary(results) if results else None
    return results, summary
