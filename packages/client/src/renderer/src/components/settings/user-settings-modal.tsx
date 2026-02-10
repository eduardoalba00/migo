import { useState } from "react";
import { X, User, Lock, Palette, Volume2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { api, resolveUploadUrl } from "@/lib/api";
import { AUTH_ROUTES, UPLOAD_ROUTES } from "@nexus/shared";

interface UserSettingsModalProps {
  onClose: () => void;
}

type Tab = "account" | "password" | "appearance" | "voice";

export function UserSettingsModal({ onClose }: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("account");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "account", label: "My Account", icon: <User className="h-4 w-4" /> },
    { id: "password", label: "Password", icon: <Lock className="h-4 w-4" /> },
    { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
    { id: "voice", label: "Voice & Audio", icon: <Volume2 className="h-4 w-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-2xl w-[700px] max-h-[80vh] flex overflow-hidden">
        <div className="w-48 bg-card border-r border-border p-3 flex flex-col gap-0.5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">User Settings</h3>
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
          {activeTab === "account" && <AccountTab />}
          {activeTab === "password" && <PasswordTab />}
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "voice" && <VoiceTab />}
        </div>
      </div>
    </div>
  );
}

function AccountTab() {
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [customStatus, setCustomStatus] = useState(user?.customStatus || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(AUTH_ROUTES.ME, { displayName, customStatus: customStatus || null });
      await fetchMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("avatar", file);

    const response = await fetch(
      `${(api as any).baseUrl || "http://localhost:8080"}${UPLOAD_ROUTES.UPLOAD}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${useAuthStore.getState().tokens?.accessToken}` },
        body: formData,
      },
    );

    if (response.ok) {
      const data = await response.json();
      await api.patch(AUTH_ROUTES.ME, { avatarUrl: data.url });
      await fetchMe();
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">My Account</h2>
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
            {user?.avatarUrl ? (
              <img src={resolveUploadUrl(user.avatarUrl)!} className="w-20 h-20 rounded-full object-cover" alt="" />
            ) : (
              user?.displayName?.charAt(0).toUpperCase()
            )}
          </div>
          <label className="absolute inset-0 rounded-full cursor-pointer flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity text-white text-xs font-medium">
            Change
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </label>
        </div>
        <div>
          <p className="font-semibold">{user?.displayName}</p>
          <p className="text-sm text-muted-foreground">@{user?.username}</p>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Custom Status</label>
          <input
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            placeholder="What are you up to?"
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function PasswordTab() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Change Password</h2>
      <div className="space-y-3 max-w-sm">
        <div>
          <label className="text-sm font-medium">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          onClick={handleChangePassword}
          disabled={saving || !currentPassword || !newPassword}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {success ? "Changed!" : saving ? "Changing..." : "Change Password"}
        </button>
      </div>
    </div>
  );
}

function AppearanceTab() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Appearance</h2>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Theme toggle is available in the titlebar. Light/dark mode is controlled by your system preference or the theme switcher.
        </p>
      </div>
    </div>
  );
}

function VoiceTab() {
  const [inputDevice, setInputDevice] = useState("");
  const [outputDevice, setOutputDevice] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const loadDevices = async () => {
    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(mediaDevices);
    } catch {}
  };

  useState(() => {
    loadDevices();
  });

  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Voice & Audio</h2>
      <div className="space-y-3 max-w-sm">
        <div>
          <label className="text-sm font-medium">Input Device</label>
          <select
            value={inputDevice}
            onChange={(e) => setInputDevice(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          >
            <option value="">Default</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Output Device</label>
          <select
            value={outputDevice}
            onChange={(e) => setOutputDevice(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-muted rounded-md text-sm outline-none"
          >
            <option value="">Default</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
