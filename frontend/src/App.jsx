import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiRequest } from './lib/api';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Progress } from './components/ui/progress';
import { Checkbox } from './components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './components/ui/dialog';
import {
  Search,
  Upload,
  Download,
  Trash2,
  Play,
  Square,
  RefreshCw,
  LogOut,
  Moon,
  Sun,
  ExternalLink,
  FileText,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Users,
  Eye,
  EyeOff,
  Copy,
  Check,
  Globe,
  Settings,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';

const STATUS_CONFIG = {
  ready: { label: 'Ready', variant: 'outline' },
  queued: { label: 'Queued', variant: 'secondary' },
  scanning: { label: 'Scanning...', variant: 'info', spinner: true },
  success: { label: 'Report ready', variant: 'success' },
  cached: { label: 'Report exists', variant: 'cached' },
  failed: { label: 'Failed', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authKey, setAuthKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('scan');
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Core Data
  const [applicants, setApplicants] = useState([]);
  const [source, setSource] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [forceRescan, setForceRescan] = useState(false);
  const [topSites, setTopSites] = useState(200);
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const [jobState, setJobState] = useState(null);
  const [logs, setLogs] = useState([]);
  const [setupData, setSetupData] = useState(null);
  const [setupLoading, setSetupLoading] = useState(false);

  // Modals & Viewers
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecks, setConsentChecks] = useState([false, false, false]);
  const [reportModal, setReportModal] = useState({ open: false, applicantId: null, name: '' });
  const [toastMessage, setToastMessage] = useState(null);
  const [copiedLog, setCopiedLog] = useState(false);
  const [formatHelpOpen, setFormatHelpOpen] = useState(false);

  const logBottomRef = useRef(null);
  const eventSourceRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (text, isError = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    apiRequest('/auth/me')
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    loadApplicants();
    loadSetup();
    connectJobStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isAuthenticated]);

  const connectJobStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/admin/osint/jobs/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const ev = JSON.parse(event.data);
        handleStreamEvent(ev);
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      apiRequest('/auth/me').catch(() => setIsAuthenticated(false));
    };
  };

  const handleStreamEvent = (ev) => {
    switch (ev.type) {
      case 'snapshot':
        setJobState(ev.state);
        if (ev.state.logs) setLogs(ev.state.logs);
        break;
      case 'log':
        setLogs((prev) => [...prev.slice(-1000), ev.message]);
        break;
      case 'status':
        setJobState((prev) => {
          if (!prev) return prev;
          const rows = { ...prev.rows, [ev.id]: { status: ev.status, detail: ev.detail, found: ev.found } };
          return { ...prev, rows };
        });
        break;
      case 'progress':
        setJobState((prev) => (prev ? { ...prev, done: ev.done, total: ev.total } : prev));
        break;
      case 'finished':
        setJobState(ev.state);
        if (ev.state.counts) {
          const c = ev.state.counts;
          showToast(`Scan complete: ${c.success} scanned, ${c.cached} cached, ${c.failed} failed.`);
        }
        loadApplicants();
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (logBottomRef.current) {
      logBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const loadApplicants = async () => {
    try {
      const data = await apiRequest('/osint/applicants');
      setApplicants(data.applicants || []);
      setSource(data.source || null);
    } catch (err) {
      if (err.status !== 401) showToast(`Failed to load applicants: ${err.message}`, true);
    }
  };

  const loadSetup = async () => {
    setSetupLoading(true);
    try {
      const data = await apiRequest('/osint/setup');
      setSetupData(data);
    } catch (err) {
      if (err.status !== 401) showToast(`Failed to run setup checks: ${err.message}`, true);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      await apiRequest('/auth/login', { method: 'POST', body: { key: authKey } });
      setAuthKey('');
      setIsAuthenticated(true);
      showToast('Signed in successfully');
    } catch (err) {
      setAuthError(err.message || 'Invalid API key');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
    setApplicants([]);
    setJobState(null);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await apiRequest('/osint/applicants/import-csv', {
        method: 'POST',
        body: { csv: text, filename: file.name },
      });
      showToast(`Imported ${res.count} candidates from ${file.name}`);
      setSelectedIds(new Set());
      await loadApplicants();
    } catch (err) {
      showToast(`CSV import error: ${err.message}`, true);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearImport = async () => {
    try {
      await apiRequest('/osint/applicants/clear-import', { method: 'POST' });
      showToast('Reverted to database records');
      setSelectedIds(new Set());
      await loadApplicants();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const initiateScan = () => {
    setConsentChecks([false, false, false]);
    setConsentOpen(true);
  };

  const confirmStartScan = async () => {
    setConsentOpen(false);
    try {
      const ids = Array.from(selectedIds);
      await apiRequest('/osint/scan', {
        method: 'POST',
        body: {
          confirmed: true,
          force: forceRescan,
          topSites: Number(topSites) || 200,
          timeoutMinutes: Number(timeoutMinutes) || 15,
          ids: ids.length ? ids : undefined,
        },
      });
      showToast('Scan started');
    } catch (err) {
      showToast(`Scan error: ${err.message}`, true);
    }
  };

  const handleStopScan = async () => {
    try {
      await apiRequest('/osint/scan/cancel', { method: 'POST' });
      showToast('Stop request sent');
    } catch (err) {
      showToast(`Stop error: ${err.message}`, true);
    }
  };

  const handleDeleteReport = async (applicantId, name) => {
    if (!window.confirm(`Delete the report for ${name}?`)) return;
    try {
      await apiRequest(`/osint/reports/${encodeURIComponent(applicantId)}`, { method: 'DELETE' });
      showToast(`Report deleted for ${name}`);
      await loadApplicants();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleDeleteAllReports = async () => {
    if (!window.confirm('Delete all scan reports? This action cannot be undone.')) return;
    try {
      const res = await apiRequest('/osint/reports', { method: 'DELETE' });
      showToast(`Deleted ${res.deleted} reports`);
      await loadApplicants();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const copyLogsToClipboard = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const isJobRunning = Boolean(jobState?.running);

  const getApplicantStatus = (applicant) => {
    const jobRow = jobState?.rows?.[applicant.id];
    if (isJobRunning && jobRow) {
      return { key: jobRow.status, label: STATUS_CONFIG[jobRow.status]?.label || jobRow.status, detail: jobRow.detail };
    }
    if (jobRow && (jobRow.status === 'failed' || jobRow.status === 'cancelled') && !applicant.report?.has) {
      return { key: jobRow.status, label: STATUS_CONFIG[jobRow.status]?.label || jobRow.status, detail: jobRow.detail };
    }
    if (applicant.problem) {
      return { key: 'skipped', label: `Skip: ${applicant.problem}`, detail: applicant.problem };
    }
    if (applicant.report?.has) {
      return { key: 'success', label: 'Report ready', detail: '' };
    }
    return { key: 'ready', label: 'Ready', detail: '' };
  };

  const filteredApplicants = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return applicants;
    return applicants.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.handle && a.handle.toLowerCase().includes(q)) ||
        String(a.id).toLowerCase().includes(q)
    );
  }, [applicants, searchQuery]);

  const scannableApplicants = filteredApplicants.filter((a) => !a.problem);
  const isAllSelected =
    scannableApplicants.length > 0 && scannableApplicants.every((a) => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(scannableApplicants.map((a) => a.id)));
    }
  };

  const toggleSelectOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const totalReportsCount = applicants.filter((a) => a.report?.has).length;
  const totalAccountsFound = applicants.reduce((acc, a) => acc + (a.report?.found || 0), 0);

  // -------------------------------------------------------------
  // Sign-in view
  // -------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm border shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <div className="w-8 h-8 rounded border bg-muted flex items-center justify-center text-foreground mb-1">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <CardTitle className="text-xl font-semibold">OSINT Candidate Screening</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">API Key</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter administrative API key"
                    value={authKey}
                    onChange={(e) => setAuthKey(e.target.value)}
                    required
                    className="pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {authError && (
                <div className="p-2.5 text-xs rounded border border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={authLoading}>
                {authLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
                {authLoading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Authenticated Dashboard
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md shadow-md border text-sm font-medium flex items-center gap-2 animate-in slide-in-from-bottom-5 duration-150 ${
            toastMessage.isError
              ? 'bg-destructive text-destructive-foreground border-destructive'
              : 'bg-card text-card-foreground border-border'
          }`}
        >
          {toastMessage.isError ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Topbar Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded border bg-muted flex items-center justify-center text-foreground font-semibold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-foreground">
              OSINT Candidate Screening
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title={isDarkMode ? 'Light mode' : 'Dark mode'}
              className="h-8 w-8"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8 text-xs">
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
        {/* Navigation Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="scan">
                <Users className="w-4 h-4 mr-1.5" />
                Screening
              </TabsTrigger>
              <TabsTrigger value="setup">
                <Settings className="w-4 h-4 mr-1.5" />
                Diagnostics
              </TabsTrigger>
            </TabsList>

            {source && (
              <Badge variant="outline" className="flex items-center gap-1.5 py-1 text-xs">
                <Database className="w-3.5 h-3.5" />
                <span>Source: {source}</span>
              </Badge>
            )}
          </div>

          {/* TAB 1: Scan Dashboard */}
          <TabsContent value="scan" className="space-y-4">
            {/* Quick Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Candidates</p>
                    <p className="text-xl font-semibold mt-0.5">{applicants.length}</p>
                  </div>
                  <Users className="w-5 h-5 text-muted-foreground" />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Scannable</p>
                    <p className="text-xl font-semibold mt-0.5">{scannableApplicants.length}</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Reports</p>
                    <p className="text-xl font-semibold mt-0.5">{totalReportsCount}</p>
                  </div>
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Accounts Found</p>
                    <p className="text-xl font-semibold mt-0.5">{totalAccountsFound}</p>
                  </div>
                  <Globe className="w-5 h-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </div>

            {/* Toolbar Card */}
            <Card>
              <CardContent className="p-3.5 space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search candidate name, handle or ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9 text-xs"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Force Rescan */}
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer border rounded-md px-3 py-2 bg-background hover:bg-muted/50 transition-colors">
                    <Checkbox
                      checked={forceRescan}
                      onChange={(e) => setForceRescan(e.target.checked)}
                      disabled={isJobRunning}
                    />
                    <span>Force rescan</span>
                  </label>

                  {/* Top Sites */}
                  <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 bg-background text-xs">
                    <span className="text-muted-foreground">Top Sites:</span>
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      step={10}
                      value={topSites}
                      onChange={(e) => setTopSites(Number(e.target.value))}
                      disabled={isJobRunning}
                      className="w-14 bg-transparent font-medium focus:outline-none"
                    />
                  </div>

                  {/* Timeout */}
                  <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 bg-background text-xs">
                    <span className="text-muted-foreground">Timeout (min):</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={timeoutMinutes}
                      onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
                      disabled={isJobRunning}
                      className="w-10 bg-transparent font-medium focus:outline-none"
                    />
                  </div>

                  <div className="flex-1" />

                  {/* Refresh */}
                  <Button variant="outline" size="sm" onClick={loadApplicants} disabled={isJobRunning}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Refresh
                  </Button>

                  {/* Import CSV */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,text/csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isJobRunning}
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      Import CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      title="CSV format & database schema reference"
                      onClick={() => setFormatHelpOpen(true)}
                    >
                      <HelpCircle className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Revert to DB */}
                  {source && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleClearImport}
                      disabled={isJobRunning}
                    >
                      <Database className="w-3.5 h-3.5 mr-1.5" />
                      Use Database
                    </Button>
                  )}

                  {/* Export CSV */}
                  <a
                    href="/api/admin/export-osint-csv"
                    download
                    className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background h-8 px-3 hover:bg-accent hover:text-accent-foreground"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Export CSV
                  </a>

                  {/* Delete All Reports */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteAllReports}
                    disabled={isJobRunning}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete all
                  </Button>

                  {/* Stop / Start Buttons */}
                  {isJobRunning ? (
                    <Button variant="destructive" size="sm" onClick={handleStopScan}>
                      <Square className="w-3.5 h-3.5 mr-1.5" />
                      Stop scan
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={initiateScan}
                      disabled={applicants.length === 0}
                    >
                      <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                      {selectedIds.size > 0
                        ? `Start scan (${selectedIds.size})`
                        : `Start scan (all ${scannableApplicants.length})`}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Scan Progress Card */}
            {(isJobRunning || jobState?.done !== undefined) && (
              <Card>
                <CardContent className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      {isJobRunning ? 'Scan in progress' : jobState?.error ? 'Scan stopped' : 'Scan completed'}
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {jobState?.done || 0} / {jobState?.total || 1} processed
                    </span>
                  </div>
                  <Progress value={jobState?.done || 0} max={jobState?.total || 1} />
                </CardContent>
              </Card>
            )}

            {/* Applicants Data Table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">
                        <Checkbox
                          checked={isAllSelected}
                          onChange={toggleSelectAll}
                          disabled={isJobRunning || scannableApplicants.length === 0}
                        />
                      </TableHead>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Target Handle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Accounts</TableHead>
                      <TableHead className="text-right pr-6">Report</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApplicants.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-28 text-center text-muted-foreground text-xs">
                          {applicants.length === 0
                            ? 'No candidate records loaded.'
                            : 'No records match search filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredApplicants.map((applicant) => {
                        const status = getApplicantStatus(applicant);
                        const isSelected = selectedIds.has(applicant.id);

                        return (
                          <TableRow key={applicant.id} className={isSelected ? 'bg-muted/40' : undefined}>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => toggleSelectOne(applicant.id)}
                                disabled={isJobRunning || Boolean(applicant.problem)}
                              />
                            </TableCell>

                            <TableCell className="font-mono text-xs text-muted-foreground">
                              #{applicant.id}
                            </TableCell>

                            <TableCell>
                              <span className="font-medium text-foreground text-sm">{applicant.name}</span>
                            </TableCell>

                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-foreground">
                                  @{applicant.handle || 'none'}
                                </code>
                                {applicant.is_fallback && (
                                  <span className="text-[10px] text-muted-foreground border px-1 rounded">
                                    fallback
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            <TableCell>
                              <Badge
                                variant={STATUS_CONFIG[status.key]?.variant || 'outline'}
                                className="flex items-center gap-1 w-fit text-xs"
                              >
                                {STATUS_CONFIG[status.key]?.spinner && (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                )}
                                <span>{status.label}</span>
                              </Badge>
                            </TableCell>

                            <TableCell className="text-center font-mono text-xs">
                              {applicant.report?.found != null ? (
                                <span>{applicant.report.found}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            <TableCell className="pr-4">
                              <div className="flex items-center justify-end gap-1">
                                {applicant.report?.html && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs px-2.5"
                                    onClick={() =>
                                      setReportModal({
                                        open: true,
                                        applicantId: applicant.id,
                                        name: applicant.name,
                                      })
                                    }
                                  >
                                    <FileText className="w-3.5 h-3.5 mr-1" />
                                    View
                                  </Button>
                                )}

                                {applicant.report?.json && (
                                  <a
                                    href={`/api/admin/osint/reports/${encodeURIComponent(applicant.id)}/json`}
                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium border border-input bg-background h-7 px-2 hover:bg-accent"
                                    title="Download JSON report"
                                  >
                                    JSON
                                  </a>
                                )}

                                {applicant.report?.has && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                    onClick={() => handleDeleteReport(applicant.id, applicant.name)}
                                    disabled={isJobRunning}
                                    title="Delete report"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Terminal Log */}
            <Card>
              <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between border-b bg-card/60">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-xs font-medium">Scanner Output</CardTitle>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={copyLogsToClipboard}
                    disabled={logs.length === 0}
                  >
                    {copiedLog ? <Check className="w-3 h-3 mr-1 text-emerald-500" /> : <Copy className="w-3 h-3 mr-1" />}
                    {copiedLog ? 'Copied' : 'Copy'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setLogs([])}
                    disabled={logs.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="bg-muted/40 font-mono text-xs text-foreground p-3 h-56 overflow-y-auto space-y-1 select-text">
                  {logs.length === 0 ? (
                    <p className="text-muted-foreground italic">No active scan logs.</p>
                  ) : (
                    logs.map((line, idx) => (
                      <div key={idx} className="leading-relaxed">
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={logBottomRef} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: Setup & Diagnostics */}
          <TabsContent value="setup" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-sm font-semibold">Environment Checks</CardTitle>
                <Button variant="outline" size="sm" onClick={loadSetup} disabled={setupLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${setupLoading ? 'animate-spin' : ''}`} />
                  Re-check
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setupData?.checks?.map((check, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-foreground text-xs">{check.label}</TableCell>
                        <TableCell>
                          {check.ok ? (
                            <Badge variant="success" className="text-xs">OK</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Issue</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{check.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-semibold">Project Files</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Path</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setupData?.files?.map((file, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{file.path}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{file.purpose}</TableCell>
                        <TableCell>
                          {file.present ? (
                            <Badge variant="outline" className="text-[10px]">Present</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Format Help Dialog */}
      <Dialog open={formatHelpOpen} onOpenChange={setFormatHelpOpen}>
        <DialogContent onClose={() => setFormatHelpOpen(false)} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Data Format Reference</DialogTitle>
            <DialogDescription className="text-xs">
              How to structure a CSV file for import, or set up the PostgreSQL database table.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1 text-xs">
            {/* CSV Format */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-foreground">CSV Import Format</h3>
              <p className="text-muted-foreground">Only <code className="bg-muted px-1 rounded">Full_Name</code> is required. All other columns are optional.</p>
              <pre className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto leading-relaxed">{
`ID,Full_Name,Target_Handle
1,Maria Santos,mariasantos
2,David Reyes,https://github.com/davidreyes
3,Sarah Connor,`
              }</pre>
              <ul className="space-y-1.5 text-muted-foreground pl-1">
                <li><code className="bg-muted px-1 rounded text-foreground">ID</code> — optional; auto-assigned from row number if missing.</li>
                <li><code className="bg-muted px-1 rounded text-foreground">Full_Name</code> — required. Also accepts separate <code className="bg-muted px-1 rounded text-foreground">First_Name</code> / <code className="bg-muted px-1 rounded text-foreground">Last_Name</code> columns.</li>
                <li><code className="bg-muted px-1 rounded text-foreground">Target_Handle</code> — optional. Full profile URLs are stripped automatically (e.g. <code className="bg-muted px-1 rounded text-foreground">https://github.com/user</code> → <code className="bg-muted px-1 rounded text-foreground">user</code>). If blank, a handle is derived from the candidate&apos;s first + last name.</li>
              </ul>
            </div>

            <div className="border-t" />

            {/* DB Schema */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-foreground">PostgreSQL Table Schema</h3>
              <p className="text-muted-foreground">The scanner reads only <code className="bg-muted px-1 rounded">id</code>, <code className="bg-muted px-1 rounded">fullname</code>, and <code className="bg-muted px-1 rounded">handle</code> from this table.</p>
              <pre className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto leading-relaxed">{
`CREATE TABLE applicants (
  id         SERIAL PRIMARY KEY,
  fullname   TEXT NOT NULL,
  handle     TEXT,   -- public username (optional)
  ...        -- other private columns never exported
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`
              }</pre>
              <p className="text-muted-foreground">Set <code className="bg-muted px-1 rounded">DATABASE_URL</code> in <code className="bg-muted px-1 rounded">backend/.env</code> to connect, or use CSV import mode without a database.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFormatHelpOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Consent Dialog */}
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent onClose={() => setConsentOpen(false)}>
          <DialogHeader>
            <DialogTitle className="text-base">Screening Verification</DialogTitle>
            <DialogDescription className="text-xs">
              Confirm ethical and legal verification requirements before initiating the scan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-2">
            {[
              'Applicants were informed that public social media handles may be verified.',
              'Scanning targets only supplied handles or candidate legal names.',
              'All findings will be manually verified before making decisions.',
            ].map((text, idx) => (
              <label
                key={idx}
                className="flex items-start gap-2.5 p-2.5 rounded border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <Checkbox
                  checked={consentChecks[idx]}
                  onChange={(e) => {
                    const next = [...consentChecks];
                    next[idx] = e.target.checked;
                    setConsentChecks(next);
                  }}
                  className="mt-0.5"
                />
                <span className="text-xs text-foreground font-medium leading-relaxed">{text}</span>
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConsentOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={confirmStartScan}
              disabled={!consentChecks.every(Boolean)}
            >
              Start scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Viewer Dialog */}
      <Dialog open={reportModal.open} onOpenChange={(open) => setReportModal({ ...reportModal, open })}>
        <DialogContent
          className="max-w-4xl h-[82vh] flex flex-col p-4"
          onClose={() => setReportModal({ ...reportModal, open: false })}
        >
          <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <DialogTitle className="text-sm font-semibold">Report: {reportModal.name}</DialogTitle>
            <a
              href={`/api/admin/osint/reports/${encodeURIComponent(reportModal.applicantId)}/html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pr-8"
            >
              Open in new tab
              <ExternalLink className="w-3 h-3" />
            </a>
          </DialogHeader>

          <div className="flex-1 w-full h-full bg-card rounded overflow-hidden border">
            {reportModal.open && reportModal.applicantId && (
              <iframe
                title="Candidate Report"
                src={`/api/admin/osint/reports/${encodeURIComponent(reportModal.applicantId)}/html`}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
