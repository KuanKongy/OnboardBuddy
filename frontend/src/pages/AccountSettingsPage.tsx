import { AlertTriangle, Github, HelpCircle, Link2, Loader2, LogOut, Mail, Pencil, Save, Shield, Trash2, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AVATAR_URL_HELP, isSafeAvatarUrl, safeAvatarSrc } from "@/lib/avatarUrl";
import { displayName } from "@/lib/displayName";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";
import { SettingsShell, type SettingsSection } from "@/components/SettingsShell";
import { applyFontSize, readStoredFontSize, type FontSizeChoice } from "@/lib/fontSize";
import { hotkeysEnabled, setHotkeysEnabled } from "@/hooks/useHotkeys";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function AccountSettingsPage() {
  const { user, signOut, connectGithub, disconnectGithub } = useAuth();
  const navigate = useNavigate();
  const [fontSize, setFontSize] = useState<FontSizeChoice>(() => readStoredFontSize());

  function chooseFontSize(choice: FontSizeChoice) {
    applyFontSize(choice);
    setFontSize(choice);
  }

  // useHotkeys reads the preference per keypress, so the write below is the whole
  // apply step. Mirrored into state only so the buttons can show which is active.
  const [hotkeys, setHotkeys] = useState(() => hotkeysEnabled());

  function chooseHotkeys(enabled: boolean) {
    setHotkeysEnabled(enabled);
    setHotkeys(enabled);
  }

  const [appConnected, setAppConnected] = useState(false);
  const [appUsername, setAppUsername] = useState<string | null>(null);
  const [appConnectionLoading, setAppConnectionLoading] = useState(true);
  const [appConnectionError, setAppConnectionError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const githubIdentity = user?.identities?.find((id) => id.provider === "github");
  const emailIdentity = user?.identities?.find((id) => id.provider === "email");
  const githubAvatar = (githubIdentity?.identity_data as Record<string, string> | undefined)?.avatar_url;

  // Sign-in methods. app_metadata.providers is GoTrue's source of truth and
  // also covers accounts whose email login predates identity rows; either
  // signal means "this account can sign in with email+password".
  const providers = ((user?.app_metadata as Record<string, unknown> | undefined)?.providers ?? []) as string[];
  const hasEmailLogin = !!emailIdentity || providers.includes("email");
  const canUnlinkGithub = !!githubIdentity && hasEmailLogin;
  // Unlinking needs the identity row itself (unlinkIdentity's argument) plus
  // another way in.
  const canUnlinkEmail = !!emailIdentity && !!githubIdentity;
  // Secure email change in flight (confirmation link not clicked yet).
  const pendingEmail = (user as { new_email?: string } | null)?.new_email;

  // ── Profile (name + avatar URL live in user_metadata). Read-only by
  // default; "Edit" switches the card to a form. Email is NOT here: it's a
  // sign-in method, managed in the Email Login card below. ──
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");

  function seedProfileForm() {
    setFullName(((meta.full_name as string) || (meta.name as string)) ?? "");
    setAvatarUrl(((meta.avatar_url as string) || githubAvatar) ?? "");
  }
  useEffect(() => {
    // Seed once per loaded user; GitHub-login users get their GitHub avatar
    // prefilled. (The avatar/name also render in read mode.)
    seedProfileForm();
  }, [user?.id]);

  async function handleSaveProfile() {
    // Reject an off-allowlist avatar before it is stored: saved once, it is
    // then fetched by the browser on every page load (§5.3 / finding X2).
    if (avatarUrl.trim() !== "" && !isSafeAvatarUrl(avatarUrl)) {
      setProfileError(AVATAR_URL_HELP);
      return;
    }
    setProfileSaving(true);
    setProfileError("");
    setProfileNotice("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim(), avatar_url: avatarUrl.trim() },
      });
      if (error) throw new Error(error.message);
      setEditingProfile(false);
      setProfileNotice("Profile saved.");
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

  // ── GitHub sign-in identity: unlink / link ─────────────────────────────────
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState("");
  const [linkingGithub, setLinkingGithub] = useState(false);
  // Removing the wrong sign-in method is how you lose access to an account. Plain
  // confirm, not type-to-confirm: unlinking is reversible, deleting a project isn't.
  const [unlinkGithubConfirmOpen, setUnlinkGithubConfirmOpen] = useState(false);
  const [unlinkEmailConfirmOpen, setUnlinkEmailConfirmOpen] = useState(false);

  async function handleUnlinkGithub() {
    if (!githubIdentity) return;
    setUnlinking(true);
    setUnlinkError("");
    try {
      const { error } = await supabase.auth.unlinkIdentity(githubIdentity);
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession();
      setUnlinkGithubConfirmOpen(false);
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to unlink GitHub");
    } finally {
      setUnlinking(false);
    }
  }

  // Link (or, after an unlink, switch to) a GitHub account as a sign-in
  // method. Redirects through GitHub's consent screen and lands back on this
  // page via /auth/callback?next=/settings. Requires Supabase manual linking.
  async function handleLinkGithub() {
    setLinkingGithub(true);
    setUnlinkError("");
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: "github",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
      });
      if (error) throw new Error(error.message);
      // On success the browser navigates away to GitHub.
    } catch (err: unknown) {
      setUnlinkError(err instanceof Error ? err.message : "Failed to start GitHub linking");
      setLinkingGithub(false);
    }
  }

  // ── Email sign-in: add (like sign-up) / unlink ─────────────────────────────
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginPasswordConfirm, setLoginPasswordConfirm] = useState("");
  const [emailLoginBusy, setEmailLoginBusy] = useState(false);
  const [emailLoginError, setEmailLoginError] = useState("");
  const [emailLoginNotice, setEmailLoginNotice] = useState("");

  // Takes a FormEvent so the dialog can be a real <form> and Enter submits.
  async function handleAddEmailLogin(e?: React.FormEvent) {
    e?.preventDefault();
    const newEmail = loginEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailLoginError("Enter a valid email address");
      return;
    }
    if (loginPassword.length < 8) {
      setEmailLoginError("Password must be at least 8 characters");
      return;
    }
    if (loginPassword !== loginPasswordConfirm) {
      setEmailLoginError("Passwords do not match");
      return;
    }
    setEmailLoginBusy(true);
    setEmailLoginError("");
    try {
      // The password applies immediately; an email different from the
      // account's current one goes through Supabase's confirmation link
      // before it becomes the sign-in address.
      const emailChanged = newEmail.toLowerCase() !== (user?.email ?? "").toLowerCase();
      const { error } = await supabase.auth.updateUser({
        ...(emailChanged ? { email: newEmail } : {}),
        password: loginPassword,
      });
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession().catch(() => {});
      setEmailDialogOpen(false);
      setEmailLoginNotice(
        emailChanged
          ? `Almost done — confirm from your inbox at ${newEmail}; email sign-in activates once confirmed.`
          : "Email sign-in enabled — you can now sign in with this email and password.",
      );
    } catch (err: unknown) {
      setEmailLoginError(err instanceof Error ? err.message : "Failed to set up email sign-in");
    } finally {
      setEmailLoginBusy(false);
    }
  }

  async function handleUnlinkEmail() {
    if (!emailIdentity) return;
    setEmailLoginBusy(true);
    setEmailLoginError("");
    setEmailLoginNotice("");
    try {
      const { error } = await supabase.auth.unlinkIdentity(emailIdentity);
      if (error) throw new Error(error.message);
      await supabase.auth.refreshSession();
      setUnlinkEmailConfirmOpen(false);
    } catch (err: unknown) {
      setEmailLoginError(err instanceof Error ? err.message : "Failed to unlink email sign-in");
    } finally {
      setEmailLoginBusy(false);
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
    setAppConnectionLoading(true);
    setAppConnectionError("");
    apiFetch("/auth/me")
      .then((data: { user: { github_connected: boolean; github_username: string | null } }) => {
        setAppConnected(data.user.github_connected);
        setAppUsername(data.user.github_username);
      })
      .catch((err: unknown) => {
        setAppConnectionError(err instanceof Error ? err.message : "Failed to check GitHub App connection");
      })
      .finally(() => setAppConnectionLoading(false));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setDisconnectError("");
    try {
      await disconnectGithub();
      setAppConnected(false);
      setAppUsername(null);
      setDisconnectConfirmOpen(false);
    } catch (err: unknown) {
      setDisconnectError(err instanceof Error ? err.message : "Failed to disconnect the GitHub App");
    } finally {
      setDisconnecting(false);
    }
  }

  // Back returns to wherever the settings gear was clicked (carried in
  // location.state by AccountCard); direct visits fall back to the dashboard.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const sections: SettingsSection[] = [
    {
      id: "settings-profile",
      label: "Profile",
      children: (
        <>
          <Card>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium text-foreground">Profile</h3>
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
                      {safeAvatarSrc(avatarUrl) && <AvatarImage src={safeAvatarSrc(avatarUrl)} alt="" />}
                      <AvatarFallback className="text-sm">{initials(fullName || displayName(user))}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <Label htmlFor="profile-name" className="text-[0.6875rem] text-muted-foreground">Full name</Label>
                        <Input
                          id="profile-name"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Your name"
                          className="mt-1 h-8 text-[0.8125rem]"
                        />
                      </div>
                      <div>
                        <Label htmlFor="profile-avatar" className="text-[0.6875rem] text-muted-foreground">Avatar URL</Label>
                        <Input
                          id="profile-avatar"
                          value={avatarUrl}
                          onChange={(e) => setAvatarUrl(e.target.value)}
                          placeholder="https://…/avatar.png"
                          className="mt-1 h-8 text-[0.8125rem]"
                        />
                        <p className="mt-1 text-[0.625rem] text-muted-foreground">{AVATAR_URL_HELP}</p>
                      </div>
                    </div>
                  </div>
                  {profileError && <p className="mt-2 text-[0.6875rem] text-destructive">{profileError}</p>}
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
                      {safeAvatarSrc(avatarUrl) && <AvatarImage src={safeAvatarSrc(avatarUrl)} alt="" />}
                      <AvatarFallback className="text-sm">{initials(fullName || displayName(user))}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      {/* The form value stays empty until the user sets a name;
                          only the VIEW falls back (GitHub username, then email
                          local part), so "No name set" never shows when
                          something is known. */}
                      <p className="truncate text-sm font-medium text-foreground">
                        {fullName || displayName(user)}
                      </p>
                      <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
                    </div>
                  </div>
                  {profileNotice && <p className="mt-2 text-[0.6875rem] text-success">{profileNotice}</p>}
                  {profileError && <p className="mt-2 text-[0.6875rem] text-destructive">{profileError}</p>}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "settings-signin",
      label: "Sign-in methods",
      children: (
        <>
          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">GitHub Login</h3>
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
                    {/* The span keeps hover working while the button is disabled —
                        disabled buttons swallow pointer events. */}
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => { setUnlinkError(""); setUnlinkGithubConfirmOpen(true); }}
                          disabled={!canUnlinkGithub || unlinking}
                        >
                          {unlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                          Unlink
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      {canUnlinkGithub
                        ? "Removes GitHub as a sign-in method; your email sign-in keeps working. You can link a different GitHub account afterwards."
                        : "GitHub is currently your only way to sign in, so unlinking would lock you out. Set up email sign-in below first."}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Not linked — you can sign in with GitHub after linking</span>
                  <Button variant="outline" size="xs" onClick={handleLinkGithub} disabled={linkingGithub}>
                    {linkingGithub ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                    Link GitHub account
                  </Button>
                </div>
              )}
              {/* While the confirm is open the failure belongs inside it — the
                  overlay covers the page behind. */}
              {unlinkError && !unlinkGithubConfirmOpen && <p className="mt-2 text-[0.6875rem] text-destructive">{unlinkError}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Email Login</h3>
              {hasEmailLogin ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    <span className="truncate font-medium text-foreground">
                      Signed in as{" "}
                      {((emailIdentity?.identity_data as Record<string, string> | undefined)?.email) ?? user?.email}
                    </span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => { setEmailLoginError(""); setUnlinkEmailConfirmOpen(true); }}
                          disabled={!canUnlinkEmail || emailLoginBusy}
                        >
                          {emailLoginBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                          Unlink
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      {canUnlinkEmail
                        ? "Removes email/password as a sign-in method; your GitHub sign-in keeps working."
                        : !githubIdentity
                          ? "Email is currently your only way to sign in, so unlinking would lock you out. Link GitHub above first."
                          : "This account's email sign-in can't be unlinked (it has no separate identity record)."}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Not set up — add an email &amp; password so you can sign in without GitHub
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setLoginEmail("");
                      setLoginPassword("");
                      setLoginPasswordConfirm("");
                      setEmailLoginError("");
                      setEmailLoginNotice("");
                      setEmailDialogOpen(true);
                    }}
                  >
                    <Mail className="h-3 w-3" />
                    Add email sign-in
                  </Button>
                </div>
              )}
              {pendingEmail && pendingEmail !== user?.email && (
                <p className="mt-2 text-[0.6875rem] text-warning">
                  Pending confirmation: {pendingEmail} — check that inbox to finish.
                </p>
              )}
              {emailLoginNotice && <p className="mt-2 text-[0.6875rem] text-success">{emailLoginNotice}</p>}
              {emailLoginError && !emailDialogOpen && !unlinkEmailConfirmOpen && (
                <p className="mt-2 text-[0.6875rem] text-destructive">{emailLoginError}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">GitHub App (Repo Import)</h3>
              {appConnectionLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking connection...
                </div>
              ) : appConnected ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Github className="h-3.5 w-3.5 text-foreground" />
                    <span className="font-medium text-foreground">
                      Connected as @{appUsername}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="xs" onClick={() => connectGithub("/settings")}>
                      Re-authorize
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => { setDisconnectError(""); setDisconnectConfirmOpen(true); }}
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
                  <Button variant="outline" size="xs" onClick={() => connectGithub("/settings")}>
                    <Github className="h-3 w-3" />
                    Authorize GitHub App
                  </Button>
                </div>
              )}
              {appConnectionError && (
                <p className="mt-2 text-[0.6875rem] text-destructive">
                  Couldn't check GitHub App connection: {appConnectionError}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "settings-preferences",
      label: "Preferences",
      children: (
        <>
          <Card>
            <CardContent className="p-3">
              {/* "Preferences" is the section name the settings shell rail uses. */}
              <h3 className="mb-2 text-xs font-medium text-foreground">Preferences</h3>
              <Label className="text-[0.6875rem] text-muted-foreground">Base font size</Label>
              <div className="mt-1 flex items-center rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Base font size">
                {(
                  [
                    { key: "default", label: "Default" },
                    { key: "large", label: "Large" },
                    { key: "xlarge", label: "Extra large" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => chooseFontSize(opt.key)}
                    aria-pressed={fontSize === opt.key}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      fontSize === opt.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* `↑`, `↓`, `/` and 1-9 fire on a bare keypress — the keys a switch
                  device or speech recognition emits while doing something else. */}
              <Label className="mt-3 block text-[0.6875rem] text-muted-foreground">Keyboard shortcuts</Label>
              <div
                className="mt-1 flex items-center rounded-lg border border-border bg-card p-0.5"
                role="group"
                aria-label="Keyboard shortcuts"
              >
                {(
                  [
                    { on: true, label: "On" },
                    { on: false, label: "Off" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => chooseHotkeys(opt.on)}
                    aria-pressed={hotkeys === opt.on}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      hotkeys === opt.on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Single-key shortcuts like <kbd className="font-mono">↑</kbd>, <kbd className="font-mono">↓</kbd> and{" "}
                <kbd className="font-mono">/</kbd>. Turning them off leaves every button and link working.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Help &amp; privacy</h3>
              <div className="space-y-1.5">
                <Link to="/help" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Help &amp; FAQ
                </Link>
                <Link to="/help#privacy" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <Shield className="h-3.5 w-3.5" />
                  What we send to the AI
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "settings-danger",
      label: "Danger zone",
      children: (
        <>
          <Card className="border-destructive/30">
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-destructive">Danger Zone</h3>
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
        </>
      ),
    },
  ];

  return (
    <div>
      {/* Header spans the full page; the shell below owns the rail and column. */}
      <PageHeader
        title="Account Settings"
        subtitle="Your profile, GitHub connection, and account access."
        actions={<BackLink to={from ?? "/dashboard"} label={from ? "Back" : "Back to dashboard"} />}
      />

      <SettingsShell sections={sections} />

      <Dialog open={emailDialogOpen} onOpenChange={(open) => !emailLoginBusy && setEmailDialogOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add email sign-in</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleAddEmailLogin}>
            <p className="text-xs text-muted-foreground">
              Works like signing up: pick the email and password you'll use to sign in to
              OnboardBuddy — it doesn't have to match your GitHub email.
            </p>
            <div>
              <Label htmlFor="login-email" className="text-[0.6875rem] text-muted-foreground">Email</Label>
              <Input
                id="login-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-8 text-[0.8125rem]"
                autoComplete="email"
              />
              {user?.email && (
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  A different address than {user.email} needs a confirmation click from its inbox first.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="login-password" className="text-[0.6875rem] text-muted-foreground">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 h-8 text-[0.8125rem]"
                autoComplete="new-password"
              />
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">Minimum 8 characters</p>
            </div>
            <div>
              <Label htmlFor="login-password-confirm" className="text-[0.6875rem] text-muted-foreground">Confirm password</Label>
              <Input
                id="login-password-confirm"
                type="password"
                value={loginPasswordConfirm}
                onChange={(e) => setLoginPasswordConfirm(e.target.value)}
                placeholder="••••••••"
                className="mt-1 h-8 text-[0.8125rem]"
                autoComplete="new-password"
              />
            </div>
            {emailLoginError && <p className="text-[0.6875rem] text-destructive">{emailLoginError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEmailDialogOpen(false)} disabled={emailLoginBusy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={emailLoginBusy}>
                {emailLoginBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                Enable email sign-in
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
              <Label htmlFor="delete-confirm" className="text-[0.6875rem] text-muted-foreground">
                Type your email ({user?.email}) to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={user?.email ?? ""}
                className="mt-1 h-8 text-[0.8125rem]"
                autoComplete="off"
              />
            </div>
            {deleteError && <p className="text-[0.6875rem] text-destructive">{deleteError}</p>}
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

      <Dialog open={disconnectConfirmOpen} onOpenChange={(open) => !disconnecting && setDisconnectConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Disconnect GitHub App</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Disconnecting removes OnboardBuddy's access to import repositories from{" "}
              {appUsername ? <>@{appUsername}</> : "this GitHub account"}. Existing projects keep
              working, but you won't be able to import new repositories until you reconnect.
            </p>
            {disconnectError && <p className="text-[0.6875rem] text-destructive">{disconnectError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDisconnectConfirmOpen(false)} disabled={disconnecting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                Disconnect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkGithubConfirmOpen} onOpenChange={(open) => !unlinking && setUnlinkGithubConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Unlink GitHub sign-in</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              GitHub stops being a way to sign in to this account. Your email sign-in
              ({user?.email}) keeps working, and you can link GitHub — the same account or a
              different one — again afterwards. This does not touch the GitHub App connection
              used for importing repositories.
            </p>
            {unlinkError && <p className="text-[0.6875rem] text-destructive">{unlinkError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setUnlinkGithubConfirmOpen(false)} disabled={unlinking}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleUnlinkGithub} disabled={unlinking}>
                {unlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                Unlink GitHub
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkEmailConfirmOpen} onOpenChange={(open) => !emailLoginBusy && setUnlinkEmailConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Unlink email sign-in</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Email and password stop being a way to sign in to this account — GitHub becomes the
              only one. You can add email sign-in again afterwards, but it needs a fresh password
              (and a confirmation click if you pick a different address).
            </p>
            {emailLoginError && <p className="text-[0.6875rem] text-destructive">{emailLoginError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setUnlinkEmailConfirmOpen(false)} disabled={emailLoginBusy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleUnlinkEmail} disabled={emailLoginBusy}>
                {emailLoginBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                Unlink email sign-in
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
