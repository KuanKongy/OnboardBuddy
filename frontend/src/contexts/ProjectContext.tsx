import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";

export interface ProjectData {
  id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  status: "idle" | "analyzing" | "complete" | "failed";
  created_at: string;
  last_analyzed_at: string | null;
  permission_tier: string;
  developer_role: string;
  settings: {
    ignored_paths: string[];
    ai_enabled: boolean;
    default_developer_role: string;
    file_limit: number;
    loc_limit: number;
  } | null;
}

interface ProjectContextValue {
  project: ProjectData | null;
  loading: boolean;
  error: string;
  refetch: () => void;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const fetchProject = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    apiFetch(`/projects/${projectId}`, { signal: controller.signal })
      .then((data: { project: ProjectData }) => {
        if (!controller.signal.aborted) setProject(data.project);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    fetchProject();
    return () => { abortRef.current?.abort(); };
  }, [fetchProject]);

  return (
    <ProjectContext.Provider
      value={{ project, loading, error, refetch: fetchProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
