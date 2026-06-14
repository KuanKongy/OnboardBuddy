import { Loader2, Mail, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProjectCard, type Project } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

type Filter = "all" | "active" | "stale" | "completed";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "stale", label: "Stale" },
  { value: "completed", label: "Completed" },
];

export function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiFetch("/projects")
      .then((data: { projects: Project[] }) => setProjects(data.projects))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredProjects = useMemo(() => {
    let result = projects;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.repo_name.toLowerCase().includes(q) ||
          p.repo_owner.toLowerCase().includes(q) ||
          p.branch.toLowerCase().includes(q),
      );
    }

    switch (filter) {
      case "active":
        result = result.filter((p) => p.status === "analyzing" || p.status === "idle");
        break;
      case "stale":
        result = result.filter((p) => p.stale_count > 0);
        break;
      case "completed":
        result = result.filter((p) => p.status === "complete");
        break;
    }

    return result;
  }, [projects, filter, search]);

  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">
        Overview &gt; All Projects
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-foreground">All Projects</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/invitations">
              <Mail className="h-3.5 w-3.5" />
              Join Project
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/import">
              <Plus className="h-3.5 w-3.5" />
              Add Project
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <div className="flex overflow-x-auto rounded-md border border-border bg-card p-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`shrink-0 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && filteredProjects.length === 0 && projects.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-foreground">No projects yet.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Import a repository to get started.
          </p>
          <Button size="sm" className="mt-3" asChild>
            <Link to="/import">
              <Plus className="h-3.5 w-3.5" />
              Import Repository
            </Link>
          </Button>
        </div>
      )}

      {!loading && !error && (filteredProjects.length > 0 || projects.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDeleted={(id) => setProjects((prev) => prev.filter((p) => p.id !== id))}
            />
          ))}

          <Link
            to="/import"
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 hover:bg-card"
          >
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-medium text-foreground">Add New Repository</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Import from GitHub
            </p>
          </Link>
        </div>
      )}
    </div>
  );
}
