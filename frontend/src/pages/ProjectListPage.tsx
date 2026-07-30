import { Mail, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { ProjectCard } from "@/components/ProjectCard";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageSpinner } from "@/components/ui/page-spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProjects } from "@/lib/useProjects";

const PAGE_SIZE = 12;

type Filter = "all" | "active" | "stale" | "completed" | "failed";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "stale", label: "Stale" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export function ProjectListPage() {
  const { projects, setProjects, loading, error } = useProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filteredProjects = useMemo(() => {
    let result = projects;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.repo_name.toLowerCase().includes(q) ||
          p.repo_owner.toLowerCase().includes(q) ||
          (p.primary_language ?? "").toLowerCase().includes(q) ||
          (p.repo_description ?? "").toLowerCase().includes(q),
      );
    }

    switch (filter) {
      case "active":
        result = result.filter(
          (p) => p.status === "analyzing" || p.status === "idle",
        );
        break;
      case "stale":
        result = result.filter((p) => p.stale_count > 0);
        break;
      case "completed":
        result = result.filter((p) => p.status === "complete");
        break;
      case "failed":
        result = result.filter((p) => p.status === "failed");
        break;
    }

    return result;
  }, [projects, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pagedProjects = useMemo(
    () => filteredProjects.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [filteredProjects, clampedPage],
  );

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function updateFilter(value: Filter) {
    setFilter(value);
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Project list"
        subtitle="Every project you have access to, in one searchable list."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/invitations">
                <Mail className="h-3.5 w-3.5" />
                Invitations
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/import">
                <Plus className="h-3.5 w-3.5" />
                Import repository
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Label htmlFor="project-search" className="sr-only">Search projects</Label>
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="project-search"
            placeholder="Search projects by name, language or description..."
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            className="h-8 pl-8 text-[0.8125rem]"
          />
        </div>
        <div className="flex overflow-x-auto rounded-md border border-border bg-card p-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => updateFilter(f.value)}
              className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
        <PageSpinner className="py-16" label="Loading your projects" />
      )}

      {error && (
        <ErrorBanner className="text-[0.8125rem]">{error}</ErrorBanner>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-foreground">No projects yet.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Import a repository to get started.
          </p>
          <Button size="sm" className="mt-3" asChild>
            <Link to="/import">
              <Plus className="h-3.5 w-3.5" />
              Import repository
            </Link>
          </Button>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        filteredProjects.length === 0 ? (
          // One combined empty state: message + actions in a single box, so a
          // filter with no matches never shows a lonely "Import repository" tile
          // next to a separate "no matches" box.
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-[0.8125rem] text-muted-foreground">
              No projects match your {search ? "search" : "filter"}.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSearch(""); setFilter("all"); setPage(1); }}
              >
                Clear filters
              </Button>
              <Button size="sm" asChild>
                <Link to="/import">
                  <Plus className="h-3.5 w-3.5" />
                  Import repository
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Fluid track count — see DashboardPage's projects grid. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
              {pagedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDeleted={(id) =>
                    setProjects((prev) => prev.filter((p) => p.id !== id))
                  }
                />
              ))}

              <Link
                to="/import"
                className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 hover:bg-card"
              >
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-[0.8125rem] font-medium text-foreground">
                  Import repository
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  From GitHub
                </p>
              </Link>
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={clampedPage <= 1}
                  onClick={() => setPage(clampedPage - 1)}
                >
                  ‹ Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {clampedPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={clampedPage >= totalPages}
                  onClick={() => setPage(clampedPage + 1)}
                >
                  Next ›
                </Button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
