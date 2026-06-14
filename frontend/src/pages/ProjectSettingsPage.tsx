import { AlertTriangle, GitBranch, Loader2, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";

export function ProjectSettingsPage() {
  const { project, refetch } = useProject();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ignoredPaths, setIgnoredPaths] = useState("");
  const [defaultRole, setDefaultRole] = useState("general");
  const [fileLimit, setFileLimit] = useState(5000);
  const [locLimit, setLocLimit] = useState(250000);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const canEdit =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  useEffect(() => {
    if (project?.settings) {
      setIgnoredPaths(project.settings.ignored_paths.join("\n"));
      setDefaultRole(project.settings.default_developer_role);
      setFileLimit(project.settings.file_limit);
      setLocLimit(project.settings.loc_limit);
    }
  }, [project]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await apiFetch(`/projects/${id}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          ignored_paths: ignoredPaths.split("\n").map((p) => p.trim()).filter(Boolean),
          default_developer_role: defaultRole,
          file_limit: fileLimit,
          loc_limit: locLimit,
        }),
      });
      setSaved(true);
      refetch();
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  if (!project) return null;

  return (
    <div className="max-w-xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Project Settings</h1>
        <Badge variant="outline" className="text-[10px] capitalize">{project.permission_tier}</Badge>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Repository &amp; branch</h3>
            <div className="space-y-1.5">
              <div>
                <Label className="text-[10px] text-muted-foreground">Repository</Label>
                <p className="text-xs text-foreground">{project.repo_owner}/{project.repo_name}</p>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Branch</Label>
                <div className="flex items-center gap-1 text-xs text-foreground">
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {project.branch}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Default developer role</h3>
            <Select value={defaultRole} onValueChange={setDefaultRole} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="backend">Backend</SelectItem>
                <SelectItem value="frontend">Frontend</SelectItem>
                <SelectItem value="devops">DevOps</SelectItem>
                <SelectItem value="qa">QA</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Ignored paths</h3>
            <Textarea
              value={ignoredPaths}
              onChange={(e) => setIgnoredPaths(e.target.value)}
              placeholder={"node_modules/\ndist/\n.env"}
              rows={4}
              disabled={!canEdit}
              className="text-[13px]"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              One path per line. These will be excluded from analysis.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Analysis limits</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Max files</Label>
                <Input
                  type="number"
                  value={fileLimit}
                  onChange={(e) => setFileLimit(Number(e.target.value))}
                  disabled={!canEdit}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max lines of code</Label>
                <Input
                  type="number"
                  value={locLimit}
                  onChange={(e) => setLocLimit(Number(e.target.value))}
                  disabled={!canEdit}
                  className="h-8 text-[13px]"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {project.permission_tier === "owner" && (
          <Card className="border-destructive/30">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                <h3 className="text-xs font-medium">Danger zone</h3>
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-foreground">Delete project</p>
                  <p className="text-[11px] text-muted-foreground">
                    Permanently delete this project and all data.
                  </p>
                </div>
                <Button variant="destructive" size="xs" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => refetch()}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saved ? "Saved!" : "Save changes"}
          </Button>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete project</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            This action cannot be undone. Type <span className="font-mono font-medium text-foreground">{project.repo_name}</span> to confirm.
          </p>
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={project.repo_name}
            className="h-8 text-[13px]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteConfirm !== project.repo_name || deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
              Delete permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
