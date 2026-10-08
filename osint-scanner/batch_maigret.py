#!/usr/bin/env python3
"""PCS OSINT batch scanner (command line). The GUI lives in gui_app.py."""
import argparse
import sys
from pathlib import Path

import scanner_core as core

try:
    from colorama import Fore, Style, init as colorama_init
    colorama_init()
except ImportError:  # colorama is optional
    class _Dummy:
        def __getattr__(self, _):
            return ""
    Fore = Style = _Dummy()

COLORS = {"success": Fore.GREEN, "cached": Fore.CYAN, "failed": Fore.RED,
          "skipped": Fore.YELLOW, "cancelled": Fore.YELLOW}


def main() -> int:
    p = argparse.ArgumentParser(description="PCS batch Maigret scanner (CLI)")
    p.add_argument("csv", nargs="?", help="Exported OSINT CSV (default: newest pcs_recruitment_osint*.csv)")
    p.add_argument("--force", action="store_true", help="Rescan applicants that already have reports")
    p.add_argument("--top-sites", type=int, default=core.DEFAULT_TOP_SITES, help="Sites to check (default 200)")
    p.add_argument("--timeout", type=int, default=core.DEFAULT_TIMEOUT_MINUTES, help="Minutes allowed per applicant")
    p.add_argument("--check", action="store_true", help="Check the environment and exit")
    args = p.parse_args()

    if args.check:
        bad = 0
        for label, ok, detail in core.environment_checks():
            print(f"[{'OK' if ok else 'X'}] {label}: {detail}")
            bad += 0 if ok else 1
        return 1 if bad else 0

    csv_path = Path(args.csv) if args.csv else core.find_latest_csv()
    if not csv_path:
        print("[X] No CSV given and no pcs_recruitment_osint*.csv found.")
        return 1
    ok, msg = core.check_maigret()
    if not ok:
        print(f"[X] Maigret: {msg}")
        return 1
    try:
        applicants = core.load_applicants(csv_path)
    except (OSError, ValueError) as e:
        print(f"[X] {e}")
        return 1

    print("\n[*] Pixel & Code Society - OSINT Vetting Engine")
    print(f"[*] Target file : {csv_path}")
    print(f"[*] Reports dir : {core.OUTPUT_DIR}\n" + "-" * 50)

    controller = core.ScanController()

    def on_status(a, status, detail, found):
        if status == "scanning":
            return
        color = COLORS.get(status, "")
        extra = f" ({detail})" if detail else ""
        print(f"{color}    -> {a.id}: {status}{extra}{Style.RESET_ALL}")

    try:
        results, summary = core.run_batch(
            applicants, controller, force=args.force, top_sites=args.top_sites,
            timeout_minutes=args.timeout, log=lambda m: print("   ", m), on_status=on_status,
        )
    except KeyboardInterrupt:
        controller.cancel()
        print("\n[!] Interrupted. Re-run to resume; completed reports are kept.")
        return 130

    counts = {s: sum(1 for r in results if r.status == s)
              for s in ("success", "cached", "failed", "skipped", "cancelled")}
    print("\n" + "=" * 50)
    print(f"[OK] {counts['success']} scanned, {counts['cached']} cached, "
          f"{counts['failed']} failed, {counts['skipped']} skipped.")
    if summary:
        print(f"[OK] Summary: {summary}")
    return 2 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
