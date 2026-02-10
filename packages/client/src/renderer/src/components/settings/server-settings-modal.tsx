import { useState, useEffect } from "react";
import { X, Settings, Users, Link, Trash2, Shield, Ban } from "lucide-react";
import { useServerStore } from "@/stores/servers";
import { useMemberStore } from "@/stores/members";
import { api, resolveUploadUrl } from "@/lib/api";
import { SERVER_ROUTES, buildRoute } from "@nexus/shared";
import type { Server, ServerMember, Invite, User } from "@nexus/shared";
import { RolesSettings } from "./roles-settings";

interface ServerSettingsModalProps {
  server: Server;
  onClose: () => void;
}

type Tab = "overview" | "members" | "invites" | "roles" | "bans";

export function ServerSettingsModal({ server, onClose }: ServerSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Settings className="h-4 w-4" /> },
    { id: "members", label: "Members", icon: <Users className="h-4 w-4" /> },
    { id: "roles", label: "Roles", icon: <Shield className="h-4 w-4" /> },
    { id: "invites", label: "Invites", icon: <Link className="h-4 w-4" /> },
    { id: "bans", label: "Bans", icon: <Ban className="h-4 w-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex overflow-hidden">
        <div className="w-48 bg-card border-r border-border p-3 flex flex-col gap-0.5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">{server.name}</h3>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 p-6 overflow-y-auto relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 text-muted-foreground hover:text-foreground rounded"
          >
            <X className="h-5 w-5" />
          </button>
          {activeTab === "overview" && <OverviewTab server={server} onClose={onClose} />}
          {activeTab === "members" && <MembersTab server={server} />}
          {activeTab === "roles" && <RolesTab server={server} />}
          {activeTab === "invites" && <InvitesTab server={server} />}
          {activeTab === "bans" && <BansTab server={server} />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ server, onClose }: { server: Server; onClose: () => void }) {
  const fetchServers = useServerStore((s) => s.fetchServers);
  const deleteServer = useServerStore((s) => s.deleteServer);
  const [name, setName] = useState(server.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(buildRoute(SERVER_ROUTES.UPDATE, { serverId: server.id }), { name });
      await fetchServers();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this server? This cannot be undone.")) return;
    await deleteServer(server.id);
    onClose();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Server Overview</h2>
      <div className="space-y-3 max-w-sm">
        <div>
          <label className="text-sm font-medium">Server Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
      <div className="pt-6 border-t border-border">
        <h3 className="text-lg font-semibold text-destructive">Danger Zone</h3>
        <button
          onClick={handleDelete}
          className="mt-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90"
        >
          Delete Server
        </button>
      </div>
    </div>
  );
}

function MembersTab({ server }: { server: Server }) {
  const members = useMemberStore((s) => s.members);
  const fetchMembers = useMemberStore((s) => s.fetchMembers);
  const [kicking, setKicking] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers(server.id);
  }, [server.id, fetchMembers]);

  const handleKick = async (userId: string) => {
    if (!confirm("Kick this member from the server?")) return;
    setKicking(userId);
    try {
      await api.delete(buildRoute(SERVER_ROUTES.KICK_MEMBER, { serverId: server.id, userId }));
      await fetchMembers(server.id);
    } finally {
      setKicking(null);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Members ({members.length})</h2>
      <div className="space-y-1">
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-muted">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
              {member.user.avatarUrl ? (
                <img src={resolveUploadUrl(member.user.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
              ) : (
                member.user.displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{member.user.displayName}</p>
              <p className="text-xs text-muted-foreground">@{member.user.username}</p>
            </div>
            {member.userId === server.ownerId ? (
              <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">Owner</span>
            ) : (
              <button
                onClick={() => handleKick(member.userId)}
                disabled={kicking === member.userId}
                className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                title="Kick"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InvitesTab({ server }: { server: Server }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvites = async () => {
    setLoading(true);
    try {
      const data = await api.get<Invite[]>(buildRoute(SERVER_ROUTES.INVITES_LIST, { serverId: server.id }));
      setInvites(data);
    } catch {
      // May fail if not owner
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, [server.id]);

  const handleDelete = async (inviteId: string) => {
    await api.delete(buildRoute(SERVER_ROUTES.INVITES_DELETE, { serverId: server.id, inviteId }));
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const handleCreate = async () => {
    const invite = await api.post<Invite>(buildRoute(SERVER_ROUTES.INVITES_CREATE, { serverId: server.id }), {});
    setInvites((prev) => [...prev, invite]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Invites</h2>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Create Invite
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invites yet</p>
      ) : (
        <div className="space-y-2">
          {invites.map((invite) => (
            <div key={invite.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-medium">{invite.code}</p>
                <p className="text-xs text-muted-foreground">
                  Used {invite.uses}{invite.maxUses ? `/${invite.maxUses}` : ""} times
                  {invite.expiresAt && ` · Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(invite.code)}
                className="px-2 py-1 text-xs text-primary hover:underline"
              >
                Copy
              </button>
              <button
                onClick={() => handleDelete(invite.id)}
                className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RolesTab({ server }: { server: Server }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Roles</h2>
      <RolesSettings serverId={server.id} />
    </div>
  );
}

interface BanEntry {
  id: string;
  userId: string;
  user: User;
  reason: string | null;
  createdAt: string;
}

function BansTab({ server }: { server: Server }) {
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBans();
  }, [server.id]);

  const fetchBans = async () => {
    setLoading(true);
    try {
      const data = await api.get<BanEntry[]>(buildRoute(SERVER_ROUTES.BANS_LIST, { serverId: server.id }));
      setBans(data);
    } catch {
      // May fail if not owner
    } finally {
      setLoading(false);
    }
  };

  const handleUnban = async (userId: string) => {
    await api.delete(buildRoute(SERVER_ROUTES.BAN_DELETE, { serverId: server.id, userId }));
    setBans((prev) => prev.filter((b) => b.userId !== userId));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Bans</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : bans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bans</p>
      ) : (
        <div className="space-y-2">
          {bans.map((ban) => (
            <div key={ban.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                {ban.user.avatarUrl ? (
                  <img src={resolveUploadUrl(ban.user.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
                ) : (
                  ban.user.displayName.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{ban.user.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  @{ban.user.username}
                  {ban.reason && ` — ${ban.reason}`}
                </p>
              </div>
              <button
                onClick={() => handleUnban(ban.userId)}
                className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
