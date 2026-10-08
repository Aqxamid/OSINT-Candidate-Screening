#!/usr/bin/env bash
# One-click launcher for Linux/macOS: creates .venv, installs deps, opens the GUI.
# Linux needs Tk once:  sudo apt install python3-tk
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
python gui_app.py
