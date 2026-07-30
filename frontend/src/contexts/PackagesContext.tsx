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
import { apiFetch } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import type { AnalysisJob, AnalysisStatus } from "@/types/analysis";
import type { PackageCard } from "@/types/onboarding";

/**
 * Project-wide package selection + the ONE /analysis-status poll for the
 * whole layout. Every feature tab reads `packageQuery` so it follows the
 * sidebar selection; the completion watcher auto-selects a package you
 * generated and brings you back to the overview when it lands.
 *
 * Selection precedence: what you picked this session (localStorage) → your
 * member default (server, set automatically when a generation you asked for
 * finishes) → null = "latest analysis" (server resolves).
 */

interface PackagesContextValue {
  packages: PackageCard[] | null;
  refreshPackages: () => void;
  selectedPackageId: string | null;
  selectedPackage: PackageCard | null;
  selectPackage: (id: string | null) => void;
  defaultPackageId: string | null;
  setDefaultPackage: (id: string | null) => Promise<void>;
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
  /** True after the last "make this my default" PUT failed. */
  defaultPackageError: boolean;
}

const PackagesContext = createContext<PackagesContextValue | undefined>(undefined);

const LATEST_SENTINEL = "latest";
const storageKey = (projectId: string) => `obb.selectedPackage.${projectId}`;

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
  const [packagesError, setPackagesError] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [defaultPackageError, setDefaultPackageError] = useState(false);
  // Whether selection still needs initializing from localStorage/default once
  // the package list is known.
  const selectionInitialized = useRef(false);

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
      .then((data: { packages: PackageCard[] }) => {
        setPackages(data.packages ?? []);
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
    } catch {
      setStatusError(true);
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

  // ── Selection init + validation once packages and project are known. ──────
  useEffect(() => {
    if (packages === null || !project) return;
    const ids = new Set(packages.map((p) => p.id));
    if (!selectionInitialized.current) {
      selectionInitialized.current = true;
      const stored = localStorage.getItem(storageKey(projectId));
      if (stored === LATEST_SENTINEL) {
        setSelectedPackageId(null);
      } else if (stored && ids.has(stored)) {
        setSelectedPackageId(stored);
      } else if (defaultPackageId && ids.has(defaultPackageId)) {
        setSelectedPackageId(defaultPackageId);
      } else {
        setSelectedPackageId(null);
      }
      return;
    }
    // A selected package that no longer exists falls back to "latest".
    if (selectedPackageId && !ids.has(selectedPackageId)) {
      setSelectedPackageId(null);
    }
  }, [packages, project, projectId, defaultPackageId, selectedPackageId]);

  const selectPackage = useCallback((id: string | null) => {
    selectionInitialized.current = true;
    setSelectedPackageId(id);
    localStorage.setItem(storageKey(projectId), id ?? LATEST_SENTINEL);
  }, [projectId]);

  // Adopt the freshly generated package once the refetched project carries
  // the server-set member default.
  useEffect(() => {
    if (!adoptDefaultOnNextProject.current || !project?.default_package_id) return;
    adoptDefaultOnNextProject.current = false;
    selectPackage(project.default_package_id);
    if (navigateOnAdopt.current) {
      navigateOnAdopt.current = false;
      const overviewPath = `/projects/${projectId}`;
      if (pathnameRef.current.replace(/\/$/, "") !== overviewPath) navigate(overviewPath);
    }
  }, [project?.default_package_id, project, projectId, navigate, selectPackage]);

  const setDefaultPackage = useCallback(async (id: string | null) => {
    // The caller fires this as `void setDefaultPackage(...)`, so a rejection would
    // be silent. Cleared on each attempt so a retry does not read as still-broken.
    setDefaultPackageError(false);
    try {
      await apiFetch(`/projects/${projectId}/default-package`, {
        method: "PUT",
        body: JSON.stringify({ package_id: id }),
      });
      refetchProject();
    } catch {
      setDefaultPackageError(true);
    }
  }, [projectId, refetchProject]);

  const registerSessionJob = useCallback((jobId: string, opts?: { navigateOnDone?: boolean }) => {
    watchedJobs.current.set(jobId, { navigateOnDone: opts?.navigateOnDone === true });
    void refreshStatus();
  }, [refreshStatus]);

  const selectedPackage = useMemo(
    () => (selectedPackageId ? (packages ?? []).find((p) => p.id === selectedPackageId) ?? null : null),
    [packages, selectedPackageId],
  );

  const packageQuery = selectedPackageId ? `?package_id=${selectedPackageId}` : "";

  const value = useMemo<PackagesContextValue>(() => ({
    packages,
    refreshPackages,
    selectedPackageId,
    selectedPackage,
    selectPackage,
    defaultPackageId,
    setDefaultPackage,
    status,
    refreshStatus,
    activeJobs,
    registerSessionJob,
    packageQuery,
    packagesError,
    statusError,
    defaultPackageError,
  }), [packages, refreshPackages, selectedPackageId, selectedPackage, selectPackage,
       defaultPackageId, setDefaultPackage, status, refreshStatus, activeJobs,
       registerSessionJob, packageQuery, packagesError, statusError, defaultPackageError]);

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
