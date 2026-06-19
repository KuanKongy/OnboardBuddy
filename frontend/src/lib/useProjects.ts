import { useEffect, useState } from "react";
import type { Project } from "@/components/ProjectCard";
import { apiFetch } from "@/lib/api";

/**
 * Shared loader for the user's projects (GET /projects).
 * Used by both the Dashboard and Project List views.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch("/projects")
      .then((data: { projects: Project[] }) => {
        if (active) setProjects(data.projects);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { projects, setProjects, loading, error };
}
