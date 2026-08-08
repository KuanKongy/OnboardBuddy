import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import type { AnalysisJob, AnalysisStatus } from "@/types/analysis";
import type { PackageCard } from "@/types/onboarding";

/**
 * Project-wide package selection + the ONE /analysis-status poll for the
 * whole layout. Every feature tab reads `packageQuery` so it follows the
 * sidebar selection; the completion watcher auto-selects a package you
 * generated and brings you back to the overview when it lands.
 *
 * Selection is per BROWSER TAB and the pin is per browser, so two tabs open on
 * the same project can sit on different packages — comparing a branch against
 * main side by side used to be impossible, because one shared localStorage key
 * meant the last tab you touched moved the other one.
 *
 * Init precedence, highest first:
 *   1. sessionStorage `obb.tabPackage.<projectId>` — what THIS tab picked
 *      (written only by selectPackage; sessionStorage is per-tab by spec).
 *   2. localStorage `obb.pinnedPackage.<projectId>` — the pin (written only by
 *      pinPackage; absent = follow the newest). What a NEW tab opens on.
 *   3. `project.default_package_id` — the member default the server sets when
 *      a generation you asked for finishes.
 *   4. null = "latest analysis", resolved server-side per request.
 *
 * The pin is also a freeze: with one set, a generation completing does not
 * move the selection onto its package (see the adopt effect).
 */

interface PackagesContextValue {
  packages: PackageCard[] | null;
  refreshPackages: () => void;
  selectedPackageId: string | null;
  selectedPackage: PackageCard | null;
  selectPackage: (id: string | null) => void;
  /**
   * The package the server serves when this tab has no selection: member
   * default, else latest. It comes from the list response because the client
   * cannot derive it — "latest" is the server's own ordering and the member
   * default lives on a row this list does not carry.
   */
  resolvedPackage: PackageCard | null;
  /** The package new tabs of this project open on; null = follow the newest. */
  pinnedPackageId: string | null;
  /** Set or clear the pin. Never touches this tab's selection. */
  pinPackage: (id: string | null) => void;
  defaultPackageId: string | null;
  status: AnalysisStatus | null;
  refreshStatus: () => Promise<void>;
  activeJobs: AnalysisJob[];
  /** Watch a job this session started; navigateOnDone returns the user to the overview when it completes. */
  registerSessionJob: (jobId: string, opts?: { navigateOnDone?: boolean }) => void;
  /** "" or "?package_id=<id>" — append to feature-tab fetches. */
  packageQuery: string;
  /** True after the most recent packages fetch failed — lets pages distinguish a real fetch error from a legitimate empty/not-yet-analyzed state. */
  packagesError: boolean;
  /** Same, for the analysis-status poll. */
  statusError: boolean;
}

const PackagesContext = createContext<PackagesContextValue | undefined>(undefined);

const LATEST_SENTINEL = "latest";
/** This tab's selection (sessionStorage — a new tab starts without it). */
const tabKey = (projectId: string) => `obb.tabPackage.${projectId}`;
/** The pin (localStorage — shared by every tab; absent means follow newest). */
const pinKey = (projectId: string) => `obb.pinnedPackage.${projectId}`;
/** Pre-pinning key, removed at init. See the comment at its removal. */
const legacyKey = (projectId: string) => `obb.selectedPackage.${projectId}`;

function isActiveStatus(s: string | undefined): boolean {
  return s === "queued" || s === "running";
}

export function PackagesProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { project, refetch: refetchProject } = useProject();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [packages, setPackages] = useState<PackageCard[] | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  // What a request with no package_id gets served, as the LIST route reports it.
  const [resolvedPackageId, setResolvedPackageId] = useState<string | null>(null);
  const [pinnedPackageId, setPinnedPackageId] = useState<string | null>(() =>
    localStorage.getItem(pinKey(projectId)),
  );
  const [packagesError, setPackagesError] = useState(false);
  const [statusError, setStatusError] = useState(false);
  // Whether selection still needs initializing from storage/default once the
  // package list is known.
  const selectionInitialized = useRef(false);

  // The provider is not remounted when the layout moves between projects, so
  // the pin is re-read rather than only initialized.
  useEffect(() => {
    setPinnedPackageId(localStorage.getItem(pinKey(projectId)));
  }, [projectId]);

  // Session-started jobs we watch for completion. Analyze jobs "adopt" the
  // worker-chained generate job via the shared snapshot_id.
  const watchedJobs = useRef(new Map<string, { navigateOnDone: boolean }>());
  const watchedSnapshots = useRef(new Map<string, { navigateOnDone: boolean }>());
  const prevJobStatuses = useRef(new Map<string, string>());
  // After a watched generation completes, the server has set our member
  // default — adopt it as the selection once the refetched project lands.
  const adoptDefaultOnNextProject = useRef(false);
  const navigateOnAdopt = useRef(false);

  const defaultPackageId = project?.default_package_id ?? null;

  const refreshPackages = useCallback(() => {
    apiFetch(`/projects/${projectId}/onboarding/packages`)
      .then((data: { packages: PackageCard[]; resolved_package_id?: string | null }) => {
        setPackages(data.packages ?? []);
        setResolvedPackageId(data.resolved_package_id ?? null);
        setPackagesError(false);
      })
      .catch(() => setPackagesError(true));
  }, [projectId]);

  const applyStatus = useCallback((data: AnalysisStatus) => {
    // Adopt chained generation jobs: a generate_package job on a snapshot one
    // of our watched analyses produced inherits its navigation intent.
    for (const job of data.jobs) {
      if (
        job.job_type === "generate_package" &&
        job.snapshot_id &&
        watchedSnapshots.current.has(job.snapshot_id) &&
        !watchedJobs.current.has(job.id)
      ) {
        watchedJobs.current.set(job.id, watchedSnapshots.current.get(job.snapshot_id)!);
      }
    }

    for (const job of data.jobs) {
      const prev = prevJobStatuses.current.get(job.id);
      const watched = watchedJobs.current.get(job.id);
      if (watched && prev !== job.status && job.status === "complete") {
        if (job.job_type === "analyze_scope" || job.job_type === "incremental_update") {
          // Analysis done; keep watching its snapshot for the chained generation.
          if (job.snapshot_id) watchedSnapshots.current.set(job.snapshot_id, watched);
        } else if (job.job_type === "generate_package") {
          watchedJobs.current.delete(job.id);
          if (job.snapshot_id) watchedSnapshots.current.delete(job.snapshot_id);
          adoptDefaultOnNextProject.current = true;
          navigateOnAdopt.current = watched.navigateOnDone;
          refetchProject();
          refreshPackages();
        } else {
          // regenerate_section and friends: content changed, selection doesn't.
          watchedJobs.current.delete(job.id);
          refreshPackages();
        }
      }
      if (watched && prev !== job.status && (job.status === "failed" || job.status === "paused")) {
        // Terminal-without-success: stop watching, keep the user where they are.
        if (job.status === "failed") watchedJobs.current.delete(job.id);
      }
      prevJobStatuses.current.set(job.id, job.status);
    }
    setStatus(data);
  }, [refetchProject, refreshPackages]);

  const refreshStatus = useCallback(async () => {
    try {
      const data = (await apiFetch(`/projects/${projectId}/analysis-status`)) as AnalysisStatus;
      applyStatus(data);
      setStatusError(false);
    } catch (err) {
      setStatusError(true);
      // 404/403 is terminal: the project (or our access to it) is gone, and
      // `hasActive` below reads the LAST GOOD status, so without this the 5s
      // poll re-requested a dead project forever. Clearing the status empties
      // activeJobs, which ends the poll; statusError keeps the banner up.
      // Transient failures (5xx, network) keep the last status and the poll.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setStatus(null);
      }
    }
  }, [projectId, applyStatus]);

  const activeJobs = useMemo(
    () => (status?.jobs ?? []).filter((j) => isActiveStatus(j.status)),
    [status],
  );

  // ── The one status poll: 5s while anything runs, otherwise idle. ──────────
  const hasActive = activeJobs.length > 0;
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    if (!hasActive) return;
    const t = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(t);
  }, [hasActive, refreshStatus]);

  // ── Package list: on mount + 8s while any package is generating. ──────────
  useEffect(() => {
    refreshPackages();
  }, [refreshPackages]);
  const anyGenerating = useMemo(
    () => (packages ?? []).some((p) => p.status === "generating"),
    [packages],
  );
  useEffect(() => {
    if (!anyGenerating) return;
    const t = window.setInterval(refreshPackages, 8000);
    return () => window.clearInterval(t);
  }, [anyGenerating, refreshPackages]);

  const selectPackage = useCallback((id: string | null) => {
    selectionInitialized.current = true;
    setSelectedPackageId(id);
    // Selection is this tab's business only — the pin is the cross-tab knob.
    sessionStorage.setItem(tabKey(projectId), id ?? LATEST_SENTINEL);
  }, [projectId]);

  const pinPackage = useCallback((id: string | null) => {
    setPinnedPackageId(id);
    // Absent, not "latest": no key at all is what "follow the newest" means,
    // so an unpin leaves nothing behind for the next tab to read.
    if (id === null) localStorage.removeItem(pinKey(projectId));
    else localStorage.setItem(pinKey(projectId), id);
  }, [projectId]);

  // ── Selection init + validation once packages and project are known. ──────
  useEffect(() => {
    if (packages === null || !project) return;
    const ids = new Set(packages.map((p) => p.id));
    if (!selectionInitialized.current) {
      selectionInitialized.current = true;
      // Dropped rather than migrated: the legacy key meant "the last selection
      // made anywhere in this browser", which is exactly the cross-tab
      // clobbering the tab/pin split removes. Migrating it into the pin would
      // resurrect that behaviour as a permanent default nobody asked for.
      localStorage.removeItem(legacyKey(projectId));
      const tabValue = sessionStorage.getItem(tabKey(projectId));
      if (tabValue === LATEST_SENTINEL) {
        setSelectedPackageId(null);
      } else if (tabValue && ids.has(tabValue)) {
        setSelectedPackageId(tabValue);
      } else if (pinnedPackageId && ids.has(pinnedPackageId)) {
        setSelectedPackageId(pinnedPackageId);
      } else if (defaultPackageId && ids.has(defaultPackageId)) {
        setSelectedPackageId(defaultPackageId);
      } else {
        setSelectedPackageId(null);
      }
      return;
    }
    // A pin whose package is gone (deleted project scope, or a regeneration
    // that minted a new id) would otherwise silently open every new tab on
    // nothing at all.
    if (pinnedPackageId && !ids.has(pinnedPackageId)) pinPackage(null);
    // A selected package that no longer exists falls back to "latest".
    if (selectedPackageId && !ids.has(selectedPackageId)) {
      setSelectedPackageId(null);
    }
  }, [packages, project, projectId, defaultPackageId, selectedPackageId, pinnedPackageId, pinPackage]);

  // Adopt the freshly generated package once the refetched project carries
  // the server-set member default.
  useEffect(() => {
    if (!adoptDefaultOnNextProject.current || !project?.default_package_id) return;
    adoptDefaultOnNextProject.current = false;
    // A pin is a standing "keep showing me this one", so a generation landing
    // must not move the selection out from under it. The navigation is the
    // other half of the courtesy and is independent: this tab asked for the
    // run, so it still gets taken to the overview to watch it land.
    if (!pinnedPackageId) selectPackage(project.default_package_id);
    if (navigateOnAdopt.current) {
      navigateOnAdopt.current = false;
      const overviewPath = `/projects/${projectId}`;
      if (pathnameRef.current.replace(/\/$/, "") !== overviewPath) navigate(overviewPath);
    }
  }, [project?.default_package_id, project, projectId, navigate, selectPackage, pinnedPackageId]);

  const registerSessionJob = useCallback((jobId: string, opts?: { navigateOnDone?: boolean }) => {
    watchedJobs.current.set(jobId, { navigateOnDone: opts?.navigateOnDone === true });
    void refreshStatus();
  }, [refreshStatus]);

  const selectedPackage = useMemo(
    () => (selectedPackageId ? (packages ?? []).find((p) => p.id === selectedPackageId) ?? null : null),
    [packages, selectedPackageId],
  );

  const resolvedPackage = useMemo(
    () => (resolvedPackageId ? (packages ?? []).find((p) => p.id === resolvedPackageId) ?? null : null),
    [packages, resolvedPackageId],
  );

  const packageQuery = selectedPackageId ? `?package_id=${selectedPackageId}` : "";

  const value = useMemo<PackagesContextValue>(() => ({
    packages,
    refreshPackages,
    selectedPackageId,
    selectedPackage,
    selectPackage,
    resolvedPackage,
    pinnedPackageId,
    pinPackage,
    defaultPackageId,
    status,
    refreshStatus,
    activeJobs,
    registerSessionJob,
    packageQuery,
    packagesError,
    statusError,
  }), [packages, refreshPackages, selectedPackageId, selectedPackage, selectPackage, resolvedPackage,
       pinnedPackageId, pinPackage, defaultPackageId, status, refreshStatus, activeJobs,
       registerSessionJob, packageQuery, packagesError, statusError]);

  return <PackagesContext.Provider value={value}>{children}</PackagesContext.Provider>;
}

export function usePackages() {
  const ctx = useContext(PackagesContext);
  if (!ctx) throw new Error("usePackages must be used within PackagesProvider");
  return ctx;
}

/** Null outside a PackagesProvider (standalone/dev routes). */
export function useOptionalPackages() {
  return useContext(PackagesContext) ?? null;
}
