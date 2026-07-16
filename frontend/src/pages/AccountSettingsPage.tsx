import { AlertTriangle, Github, Loader2, LogOut, Pencil, Save, Trash2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function AccountSettingsPage() {
  const { user, signOut, connectGithub, disconnectGithub } = useAuth();
  const navigate = useNavigate();

  const [appConnected, setAppConnected] = useState(false);
  const [appUsername, setAppUsername] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const githubIdentity = user?.identities?.find((id) => id.provider === "github");
  const emailIdentity = user?.identities?.find((id) => id.provider === "email");
  const githubAvatar = (githubIdentity?.identity_data as Record<string, string> | undefined)?.avatar_url;

  // ── Profile (name + avatar URL live in user_metadata; email on the auth
  // user itself). Read-only by default; "Edit" switches the card to a form. ──
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  // Email a confirmation is still pending for (secure email change).
  const pendingEmail = (user as { new_email?: string } | null)?.new_email;

  function seedProfileForm() {
    setFullName(((meta.full_name as string) || (meta.name as string)) ?? "");
    setAvatarUrl(((meta.avatar_url as string) || githubAvatar) ?? "");
    setEmail(user?.email ?? "");
  }
  useEffect(() => {
    // Seed once per loaded user; GitHub-login users get their GitHub avatar
    // prefilled. (The avatar/name also render in read mode.)
    seedProfileForm();
  }, [user?.id]);

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileError("");
    setProfileNotice("");
    try {
      // Email changes ride along only when actually changed — Supabase sends
      // a confirmation link and applies the change once it's clicked. An
      // OAuth-only account starts with no email at all; setting one here is
      // what makes email sign-in (and unlinking GitHub) possible later.
      const newEmail = email.trim();
      const emailChanged = newEmail !== "" && newEmail.toLowerCase() !== (user?.email ?? "").toLowerCase();
      const { error } = await supabase.auth.updateUser({
        ...(emailChanged ? { email: newEmail } : {}),
        data: { full_name: fullName.trim(), avatar_url: avatarUrl.trim() },
      });
      if (error) throw new Error(error.message);
      setEditingProfile(false);
      setProfileNotice(
        emailChanged
          ? `Profile saved. Check ${newEmail} for a confirmation link — the email change applies once confirmed.`
          : "Profile saved.",
      );
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  function startEditProfile() {
    seedProfileForm();
    setProfileError("");
    setProfileNotice("");
    setEditingProfile(true);
  }

  function cancelEditProfile() {
    seedProfileForm();
    setProfileError("");
    setEditingProfile(false);
  }

  // ── GitHub sign-in identity unlink ─────────────────────────────────────────
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState("");
  const canUnlinkGithub = !!githubIdentity && !!emailIdentity;

  async function handleUnlinkGithub() {
    if (!githubIdentity) return;
    setUnlinking(true);
    setUnlinkError("");
    try {
      const { error } = await supabase.auth.unlinkIdentity(githubIdentity);
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession();
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to unlink GitHub");
    } finally {
      setUnlinking(false);
    }
  }

  // ── Delete account ─────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch("/auth/account", { method: "DELETE" });
      await supabase.auth.signOut().catch(() => {});
      navigate("/");
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete the account");
      setDeleting(false);
    }
  }

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  useEffect(() => {
    apiFetch("/auth/me")
      .then((data: { user: { github_connected: boolean; github_username: string | null } }) => {
        setAppConnected(data.user.github_connected);
        setAppUsername(data.user.github_username);
      })
      .catch(() => {});
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectGithub();
      setAppConnected(false);
      setAppUsername(null);
    } catch {
      // swallow
    } finally {
      setDisconnecting(false);
    }
  }

  // Back returns to wherever the settings gear was clicked (carried in
  // location.state by AccountCard); direct visits fall back to the dashboard.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <div>
      {/* Header spans the full page like every other tab; only the card
          column below is centered and narrow. */}
      <PageHeader
        title="Account Settings"
        subtitle="Your profile, GitHub connection, and account access."
        actions={<BackLink to={from ?? "/dashboard"} label={from ? "Back" : "Back to dashboard"} />}
      />
      <div className="mx-auto max-w-xl">

      <Card className="mb-3">
        <CardContent className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-medium text-foreground">Profile</h2>
            {!editingProfile && (
              <Button variant="outline" size="xs" onClick={startEditProfile}>
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            )}
          </div>

          {editingProfile ? (
            <>
              <div className="flex items-start gap-3">
                <Avatar className="mt-1 size-12">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
                  <AvatarFallback className="text-sm">{initials(fullName || user?.email || "?")}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <Label htmlFor="profile-name" className="text-[11px] text-muted-foreground">Full name</Label>
                    <Input
                      id="profile-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                      className="mt-1 h-8 text-[13px]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="profile-avatar" className="text-[11px] text-muted-foreground">Avatar URL</Label>
                    <Input
                      id="profile-avatar"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://…/avatar.png"
                      className="mt-1 h-8 text-[13px]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="profile-email" className="text-[11px] text-muted-foreground">Email</Label>
                    <Input
                      id="profile-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="mt-1 h-8 text-[13px]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {user?.email
                        ? "Changing it sends a confirmation link before anything switches over."
                        : "Signed up through GitHub, so no email is set yet — add one to enable email sign-in and password reset."}
                    </p>
                  </div>
                </div>
              </div>
              {profileError && <p className="mt-2 text-[11px] text-destructive">{profileError}</p>}
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <Button variant="ghost" size="xs" onClick={cancelEditProfile} disabled={profileSaving}>
                  Cancel
                </Button>
                <Button size="xs" onClick={handleSaveProfile} disabled={profileSaving}>
                  {profileSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save profile
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
                  <AvatarFallback className="text-sm">{initials(fullName || user?.email || "?")}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {fullName || <span className="text-muted-foreground">No name set</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user?.email || "No email set"}
                    {pendingEmail && pendingEmail !== user?.email && (
                      <span className="text-amber-600 dark:text-amber-400"> · pending confirmation: {pendingEmail}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
                </div>
              </div>
              {profileNotice && <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">{profileNotice}</p>}
              {profileError && <p className="mt-2 text-[11px] text-destructive">{profileError}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-foreground">GitHub Login</h2>
          {githubIdentity ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Github className="h-3.5 w-3.5 text-foreground" />
                <span className="font-medium text-foreground">
                  Signed in as{" "}
                  {(githubIdentity.identity_data as Record<string, string>)?.user_name ?? "GitHub User"}
                </span>
              </div>
              <Tooltip>
                {/* The span keeps hover working while the button is disabled
                    (disabled buttons swallow pointer events), so the "why" is
                    always one hover away. */}
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleUnlinkGithub}
                      disabled={!canUnlinkGithub || unlinking}
                    >
                      {unlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                      Unlink
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64">
                  {canUnlinkGithub
                    ? "Removes GitHub as a sign-in method; your email/password sign-in keeps working."
                    : "GitHub is currently your only way to sign in, so unlinking would lock you out. Add an email above and set a password (via “Forgot password” on the sign-in page) first."}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Signed in with email/password</span>
          )}
          {unlinkError && <p className="mt-2 text-[11px] text-destructive">{unlinkError}</p>}
        </CardContent>
      </Card>

      <Card className="mb-3">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-foreground">GitHub App (Repo Import)</h2>
          {appConnected ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Github className="h-3.5 w-3.5 text-foreground" />
                <span className="font-medium text-foreground">
                  Connected as @{appUsername}
                </span>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="xs" onClick={() => connectGithub()}>
                  Re-authorize
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  <Unplug className="h-3 w-3" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Not connected — required for repo import</span>
              <Button variant="outline" size="xs" onClick={() => connectGithub()}>
                <Github className="h-3 w-3" />
                Authorize GitHub App
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="p-3">
          <h2 className="mb-2 text-xs font-medium text-destructive">Danger Zone</h2>
          <Separator className="mb-2" />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => signOut()}>
              <LogOut className="h-3 w-3" />
              Sign Out
            </Button>
            <Button variant="destructive" size="sm" onClick={() => { setDeleteConfirm(""); setDeleteError(""); setDeleteOpen(true); }}>
              <Trash2 className="h-3 w-3" />
              Delete account
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span>
                This permanently deletes your sign-in, your profile, and <strong>every project you
                own</strong> — including all analyses, onboarding packages, and team memberships.
                Runs you started in other people's projects are re-attributed to those projects'
                owners. This cannot be undone.
              </span>
            </div>
            <div>
              <Label htmlFor="delete-confirm" className="text-[11px] text-muted-foreground">
                Type your email ({user?.email}) to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={user?.email ?? ""}
                className="mt-1 h-8 text-[13px]"
                autoComplete="off"
              />
            </div>
            {deleteError && <p className="text-[11px] text-destructive">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirm.trim().toLowerCase() !== (user?.email ?? "").toLowerCase()}
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete everything
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
