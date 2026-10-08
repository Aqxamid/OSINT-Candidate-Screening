#!/usr/bin/env python3
"""PCS OSINT Vetting Scanner - desktop GUI (Tkinter, standard library only)."""
import datetime
import queue
import threading
import tkinter as tk
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

import scanner_core as core

STATUS_LABELS = {
    "scanning": "Scanning...", "success": "Done", "cached": "Report exists",
    "failed": "Failed", "skipped": "Skipped", "cancelled": "Cancelled",
}
MAX_LOG_LINES = 5000


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PCS OSINT Vetting Scanner")
        self.geometry("1100x800")
        self.minsize(920, 660)

        self.q = queue.Queue()
        self.controller = None
        self.worker = None
        self.applicants = []
        self.consent_given = False

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=8, pady=8)
        self.tab_scan = ttk.Frame(nb, padding=8)
        self.tab_setup = ttk.Frame(nb, padding=8)
        nb.add(self.tab_scan, text="  Scan  ")
        nb.add(self.tab_setup, text="  Setup & Files  ")
        self._build_scan_tab()
        self._build_setup_tab()

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(100, self._poll)
        self.after(300, self._run_checks)

        latest = core.find_latest_csv()
        if latest:
            self.csv_var.set(str(latest))
            self._load_csv()

    # ------------------------------------------------------------ scan tab
    def _build_scan_tab(self):
        f = self.tab_scan

        box1 = ttk.LabelFrame(f, text="1. Get the applicants CSV", padding=8)
        box1.pack(fill="x")
        box1.columnconfigure(1, weight=1)
        box1.columnconfigure(3, weight=1)

        ttk.Label(box1, text="Backend URL").grid(row=0, column=0, sticky="w")
        self.url_var = tk.StringVar(value="http://localhost:5000")
        ttk.Entry(box1, textvariable=self.url_var).grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Label(box1, text="Admin token").grid(row=0, column=2, sticky="w")
        self.token_var = tk.StringVar()
        ttk.Entry(box1, textvariable=self.token_var, show="*").grid(row=0, column=3, sticky="ew", padx=6)
        self.dl_btn = ttk.Button(box1, text="Download from backend", command=self._download)
        self.dl_btn.grid(row=0, column=4, padx=(6, 0))

        ttk.Label(box1, text="...or CSV file").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.csv_var = tk.StringVar()
        ttk.Entry(box1, textvariable=self.csv_var).grid(row=1, column=1, columnspan=3, sticky="ew", padx=6, pady=(8, 0))
        btns = ttk.Frame(box1)
        btns.grid(row=1, column=4, pady=(8, 0), sticky="e")
        ttk.Button(btns, text="Browse...", command=self._browse).pack(side="left")
        ttk.Button(btns, text="Load", command=self._load_csv).pack(side="left", padx=(6, 0))

        box2 = ttk.LabelFrame(f, text="2. Review applicants (double-click a row to open its report)", padding=8)
        box2.pack(fill="both", expand=True, pady=8)
        cols = ("id", "name", "handle", "division", "status", "found")
        self.tree = ttk.Treeview(box2, columns=cols, show="headings", height=9, selectmode="browse")
        for c, title, w in (("id", "ID", 60), ("name", "Full name", 220), ("handle", "Handle", 180),
                            ("division", "Main division", 180), ("status", "Status", 220),
                            ("found", "Accounts found*", 130)):
            self.tree.heading(c, text=title)
            self.tree.column(c, width=w, anchor="w")
        sb = ttk.Scrollbar(box2, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", lambda _e: self._open_selected())
        for tag, color in (("ready", "#000000"), ("skip", "#b45309"), ("scanning", "#1d4ed8"),
                           ("success", "#15803d"), ("cached", "#0e7490"),
                           ("failed", "#b91c1c"), ("cancelled", "#b45309")):
            self.tree.tag_configure(tag, foreground=color)

        box3 = ttk.LabelFrame(f, text="3. Scan", padding=8)
        box3.pack(fill="x")
        opts = ttk.Frame(box3)
        opts.pack(fill="x")
        self.force_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(opts, text="Force rescan (overwrite existing reports)", variable=self.force_var).pack(side="left")
        ttk.Label(opts, text="   Top sites:").pack(side="left")
        self.top_var = tk.IntVar(value=core.DEFAULT_TOP_SITES)
        ttk.Spinbox(opts, from_=10, to=1000, increment=10, width=6, textvariable=self.top_var).pack(side="left", padx=4)
        ttk.Label(opts, text="Timeout/applicant (min):").pack(side="left", padx=(12, 0))
        self.timeout_var = tk.IntVar(value=core.DEFAULT_TIMEOUT_MINUTES)
        ttk.Spinbox(opts, from_=1, to=120, width=5, textvariable=self.timeout_var).pack(side="left", padx=4)

        act = ttk.Frame(box3)
        act.pack(fill="x", pady=(8, 0))
        self.start_btn = ttk.Button(act, text="Start scan", command=self._start)
        self.start_btn.pack(side="left")
        self.stop_btn = ttk.Button(act, text="Stop", command=self._stop, state="disabled")
        self.stop_btn.pack(side="left", padx=6)
        ttk.Button(act, text="Open selected report", command=self._open_selected).pack(side="left", padx=(18, 6))
        ttk.Button(act, text="Open reports folder", command=self._open_reports).pack(side="left")

        prog = ttk.Frame(box3)
        prog.pack(fill="x", pady=(8, 0))
        self.progress = ttk.Progressbar(prog, mode="determinate")
        self.progress.pack(side="left", fill="x", expand=True)
        self.progress_label = ttk.Label(prog, text="Idle", width=34, anchor="e")
        self.progress_label.pack(side="left", padx=(8, 0))

        box4 = ttk.LabelFrame(f, text="Log", padding=8)
        box4.pack(fill="both", expand=False, pady=(8, 0))
        self.log_box = ScrolledText(box4, height=9, state="disabled", wrap="none", font=("Courier", 9))
        self.log_box.pack(fill="both", expand=True)
        ttk.Label(f, text="* Approximate count taken from Maigret's JSON. Matching a username does NOT prove "
                          "the account belongs to the applicant. A human must verify.",
                  foreground="#555555", wraplength=1040).pack(anchor="w", pady=(6, 0))

    # ------------------------------------------------------------ setup tab
    def _build_setup_tab(self):
        f = self.tab_setup
        ttk.Label(f, text="Shows what the scanner needs and which project files are present. "
                          "'You add' items must be created or exported by you.",
                  wraplength=1040).pack(anchor="w")

        box = ttk.LabelFrame(f, text="Environment checks", padding=8)
        box.pack(fill="x", pady=8)
        self.checks = ttk.Treeview(box, columns=("check", "status", "detail"), show="headings", height=5)
        for c, t, w in (("check", "Check", 200), ("status", "Status", 80), ("detail", "Detail", 760)):
            self.checks.heading(c, text=t)
            self.checks.column(c, width=w, anchor="w")
        self.checks.pack(fill="x")
        self.checks.tag_configure("ok", foreground="#15803d")
        self.checks.tag_configure("bad", foreground="#b91c1c")

        row = ttk.Frame(box)
        row.pack(fill="x", pady=(8, 0))
        ttk.Button(row, text="Re-run checks", command=self._run_checks).pack(side="left")
        ttk.Button(row, text="Open scanner folder", command=lambda: core.open_in_file_manager(core.APP_DIR)).pack(side="left", padx=6)
        ttk.Button(row, text="Open Maigret on GitHub", command=lambda: webbrowser.open("https://github.com/soxoj/maigret")).pack(side="left")

        box2 = ttk.LabelFrame(f, text=f"Project files (relative to {core.PROJECT_ROOT})", padding=8)
        box2.pack(fill="both", expand=True)
        cols = ("path", "purpose", "group", "who", "status")
        self.files = ttk.Treeview(box2, columns=cols, show="headings")
        for c, t, w in (("path", "File / folder", 320), ("purpose", "Purpose", 300), ("group", "Group", 70),
                        ("who", "Provided by", 200), ("status", "Status", 90)):
            self.files.heading(c, text=t)
            self.files.column(c, width=w, anchor="w")
        sb = ttk.Scrollbar(box2, orient="vertical", command=self.files.yview)
        self.files.configure(yscrollcommand=sb.set)
        self.files.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.files.tag_configure("found", foreground="#15803d")
        self.files.tag_configure("missing", foreground="#b91c1c")
        self.files.tag_configure("optional", foreground="#b45309")
        self._refresh_files()

    def _refresh_files(self):
        self.files.delete(*self.files.get_children())
        for path, purpose, group, who in core.expected_files():
            present = core.file_status(path)
            if present:
                tag, text = "found", "Found"
            elif who.startswith("Auto"):
                tag, text = "optional", "Not yet"
            else:
                tag, text = "missing", "Missing"
            self.files.insert("", "end", values=(path, purpose, group, who, text), tags=(tag,))

    def _run_checks(self):
        self._refresh_files()
        self.checks.delete(*self.checks.get_children())
        self.checks.insert("", "end", values=("Running checks...", "", "Maigret can take a few seconds to start"))

        def work():
            self.q.put(("checks", core.environment_checks()))
        threading.Thread(target=work, daemon=True).start()

    # ------------------------------------------------------------ helpers
    def _log(self, text):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", text + "\n")
        lines = int(self.log_box.index("end-1c").split(".")[0])
        if lines > MAX_LOG_LINES:
            self.log_box.delete("1.0", f"{lines - MAX_LOG_LINES}.0")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _set_running(self, running):
        self.start_btn.configure(state="disabled" if running else "normal")
        self.stop_btn.configure(state="normal" if running else "disabled")

    def _spin(self, var, default):
        try:
            return max(1, int(var.get()))
        except (tk.TclError, ValueError):
            return default

    # ------------------------------------------------------------ CSV loading
    def _browse(self):
        path = filedialog.askopenfilename(
            title="Select exported OSINT CSV", initialdir=str(core.APP_DIR),
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")])
        if path:
            self.csv_var.set(path)
            self._load_csv()

    def _load_csv(self):
        path = self.csv_var.get().strip()
        if not path:
            messagebox.showinfo("No file", "Choose a CSV file first.")
            return
        try:
            self.applicants = core.load_applicants(path)
        except (OSError, ValueError) as e:
            messagebox.showerror("Cannot load CSV", str(e))
            return
        self.tree.delete(*self.tree.get_children())
        ready = 0
        for a in self.applicants:
            if a.problem:
                status, tag, found = f"Skip: {a.problem}", "skip", ""
            elif core.has_report(core.report_dir(a.id)):
                status, tag = "Report exists", "cached"
                found = core.count_found(core.report_dir(a.id))
                found = "" if found is None else found
                ready += 1
            else:
                status, tag, found = "Ready", "ready", ""
                ready += 1
            self.tree.insert("", "end", iid=str(a.row), tags=(tag,),
                             values=(a.id, a.name, a.handle, a.division, status, found))
        skipped = len(self.applicants) - ready
        self.progress.configure(value=0, maximum=max(1, len(self.applicants)))
        self.progress_label.configure(text=f"{len(self.applicants)} loaded, {skipped} will be skipped")
        self._log(f"Loaded {len(self.applicants)} applicants from {path}")

    # ------------------------------------------------------------ download
    def _download(self):
        url = self.url_var.get().strip().rstrip("/")
        token = self.token_var.get().strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            messagebox.showerror("Invalid URL", "Enter a URL like http://localhost:5000")
            return
        if not token:
            messagebox.showwarning("Token needed", "Enter the admin token (ADMIN_API_KEY from backend/.env).")
            return
        local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if parsed.scheme == "http" and not local:
            if not messagebox.askyesno("Insecure connection",
                                       "This URL is not HTTPS, so the admin token would be sent unencrypted.\n\nContinue anyway?"):
                return
        dest = core.APP_DIR / f"pcs_recruitment_osint_{datetime.date.today().isoformat()}.csv"
        self.dl_btn.configure(state="disabled")
        self._log(f"Downloading CSV from {url} ...")
        threading.Thread(target=self._download_worker,
                         args=(url + "/api/admin/export-osint-csv", token, dest), daemon=True).start()

    def _download_worker(self, endpoint, token, dest):
        req = urllib.request.Request(endpoint, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                dest.write_bytes(resp.read())
            self.q.put(("downloaded", str(dest), None))
        except urllib.error.HTTPError as e:
            msgs = {401: "Missing token.", 403: "Wrong admin token.",
                    404: "No applicants found, or the URL is wrong.",
                    500: "Backend error (check ADMIN_API_KEY and DATABASE_URL in backend/.env)."}
            self.q.put(("downloaded", None, f"HTTP {e.code}: {msgs.get(e.code, e.reason)}"))
        except Exception as e:  # noqa: BLE001
            self.q.put(("downloaded", None, f"Could not reach the backend: {e}"))

    # ------------------------------------------------------------ scan control
    def _start(self):
        if self.worker and self.worker.is_alive():
            return
        if not self.applicants:
            messagebox.showinfo("Nothing to scan", "Load a CSV first.")
            return
        ok, msg = core.check_maigret()
        if not ok:
            messagebox.showerror("Maigret problem", f"{msg}\n\nSee the 'Setup & Files' tab.")
            return
        if not self.consent_given:
            if not messagebox.askyesno(
                    "Before you scan",
                    "Please confirm:\n\n"
                    "- Applicants were told their submitted handle may be reviewed.\n"
                    "- You are scanning only handles the applicants supplied.\n"
                    "- Results will be verified by a human before any decision.\n\nContinue?"):
                return
            self.consent_given = True

        for a in self.applicants:
            iid = str(a.row)
            if a.problem:
                self.tree.item(iid, tags=("skip",))
                self.tree.set(iid, "status", f"Skip: {a.problem}")
            else:
                self.tree.item(iid, tags=("ready",))
                self.tree.set(iid, "status", "Queued")
        self.progress.configure(value=0, maximum=max(1, len(self.applicants)))
        self.progress_label.configure(text="Starting...")
        self._set_running(True)

        self.controller = core.ScanController()
        args = (list(self.applicants), self.force_var.get(),
                self._spin(self.top_var, core.DEFAULT_TOP_SITES),
                self._spin(self.timeout_var, core.DEFAULT_TIMEOUT_MINUTES))
        self.worker = threading.Thread(target=self._work, args=args, daemon=True)
        self.worker.start()

    def _work(self, applicants, force, top, timeout):
        try:
            results, summary = core.run_batch(
                applicants, self.controller, force=force, top_sites=top, timeout_minutes=timeout,
                log=lambda m: self.q.put(("log", m)),
                on_status=lambda a, s, d, f: self.q.put(("status", a.row, s, d, f)),
                on_progress=lambda i, t: self.q.put(("progress", i, t)))
            self.q.put(("done", results, summary))
        except Exception as e:  # noqa: BLE001
            self.q.put(("error", str(e)))

    def _stop(self):
        if self.controller:
            self.controller.cancel()
            self._log("Stopping... (current scan will be cancelled)")
            self.stop_btn.configure(state="disabled")

    # ------------------------------------------------------------ opening reports
    def _open_reports(self):
        core.OUTPUT_DIR.mkdir(exist_ok=True)
        core.open_in_file_manager(core.OUTPUT_DIR)

    def _open_selected(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Select a row", "Select an applicant in the table first.")
            return
        a = self.applicants[int(sel[0])]
        html = core.find_html(core.report_dir(a.id)) if not a.problem else None
        if html:
            webbrowser.open(html.as_uri())
        else:
            messagebox.showinfo("No report", f"No report exists yet for applicant {a.id}.")

    # ------------------------------------------------------------ event loop
    def _poll(self):
        try:
            while True:
                self._handle(self.q.get_nowait())
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _handle(self, ev):
        kind = ev[0]
        if kind == "log":
            self._log(ev[1])
        elif kind == "status":
            _, row, status, detail, found = ev
            iid = str(row)
            if not self.tree.exists(iid):
                return
            label = STATUS_LABELS.get(status, status)
            if detail:
                label += f": {detail}"
            self.tree.set(iid, "status", label)
            self.tree.set(iid, "found", "" if found is None else found)
            self.tree.item(iid, tags=("skip" if status == "skipped" else status,))
            if status == "scanning":
                self.tree.see(iid)
        elif kind == "progress":
            _, i, total = ev
            self.progress.configure(maximum=max(1, total), value=i)
            self.progress_label.configure(text=f"{i} / {total} processed")
        elif kind == "done":
            _, results, summary = ev
            self._set_running(False)
            counts = {s: sum(1 for r in results if r.status == s)
                      for s in ("success", "cached", "failed", "skipped", "cancelled")}
            text = (f"{counts['success']} scanned, {counts['cached']} existing, "
                    f"{counts['failed']} failed, {counts['skipped']} skipped"
                    + (f", {counts['cancelled']} cancelled" if counts["cancelled"] else ""))
            self.progress_label.configure(text="Finished")
            self._log(f"=== Finished: {text}")
            if summary:
                self._log(f"=== Summary saved: {summary}")
            messagebox.showinfo("Scan finished", text + (f"\n\nSummary:\n{summary}" if summary else ""))
        elif kind == "error":
            self._set_running(False)
            self._log(f"ERROR: {ev[1]}")
            messagebox.showerror("Scan error", ev[1])
        elif kind == "downloaded":
            _, path, err = ev
            self.dl_btn.configure(state="normal")
            if err:
                self._log(f"Download failed: {err}")
                messagebox.showerror("Download failed", err)
            else:
                self._log(f"Saved CSV to {path}")
                self.csv_var.set(path)
                self._load_csv()
        elif kind == "checks":
            self.checks.delete(*self.checks.get_children())
            for label, ok, detail in ev[1]:
                self.checks.insert("", "end", values=(label, "OK" if ok else "PROBLEM", detail),
                                   tags=("ok" if ok else "bad",))

    def _on_close(self):
        if self.worker and self.worker.is_alive():
            if not messagebox.askyesno("Scan running", "A scan is still running. Stop it and quit?"):
                return
            self.controller.cancel()
        self.destroy()


if __name__ == "__main__":
    App().mainloop()
