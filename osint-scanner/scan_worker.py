#!/usr/bin/env python3
"""NDJSON scan worker used by the web dashboard (backend/services/scanJobService.js).

stdout carries ONLY JSON lines:  {"type": "log|status|progress|done|error|checks", ...}
stdin  (with --watch-stdin): a line "cancel" cancels the scan; EOF also cancels (parent died).
"""
import argparse
import json
import sys
import threading

import scanner_core as core

_lock = threading.Lock()


def emit(**event):
    with _lock:
        sys.stdout.write(json.dumps(event) + "\n")  # ASCII-escaped: safe on any console encoding
        sys.stdout.flush()


def watch_stdin(controller):
    try:
        for line in sys.stdin:
            if line.strip().lower() == "cancel":
                break
    except Exception:  # noqa: BLE001
        pass
    controller.cancel()


def main() -> int:
    p = argparse.ArgumentParser(description="PCS scan worker (NDJSON)")
    p.add_argument("csv", nargs="?")
    p.add_argument("--check", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--top-sites", type=int, default=core.DEFAULT_TOP_SITES)
    p.add_argument("--timeout", type=int, default=core.DEFAULT_TIMEOUT_MINUTES)
    p.add_argument("--watch-stdin", action="store_true")
    args = p.parse_args()

    if args.check:
        emit(type="checks", checks=[{"label": l, "ok": ok, "detail": d}
                                    for l, ok, d in core.environment_checks(include_gui=False)])
        return 0
    if not args.csv:
        emit(type="error", message="No CSV path given")
        return 1
    ok, msg = core.check_maigret()
    if not ok:
        emit(type="error", message=f"Maigret: {msg}")
        return 1
    try:
        applicants = core.load_applicants(args.csv)
    except (OSError, ValueError) as e:
        emit(type="error", message=str(e))
        return 1

    controller = core.ScanController()
    if args.watch_stdin:
        threading.Thread(target=watch_stdin, args=(controller,), daemon=True).start()

    try:
        results, summary = core.run_batch(
            applicants, controller, force=args.force,
            top_sites=max(10, min(1000, args.top_sites)),
            timeout_minutes=max(1, min(120, args.timeout)),
            log=lambda m: emit(type="log", message=m),
            on_status=lambda a, s, d, f: emit(type="status", id=a.id, row=a.row, status=s, detail=d, found=f),
            on_progress=lambda i, t: emit(type="progress", done=i, total=t),
        )
    except Exception as e:  # noqa: BLE001
        emit(type="error", message=f"{type(e).__name__}: {e}")
        return 1

    counts = {s: sum(1 for r in results if r.status == s)
              for s in ("success", "cached", "failed", "skipped", "cancelled")}
    emit(type="done", counts=counts, summary=summary.name if summary else None, cancelled=controller.cancelled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
