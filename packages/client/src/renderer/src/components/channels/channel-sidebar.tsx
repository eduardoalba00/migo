import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Hash, Volume2, Plus, LogOut, Link, Settings, Trash2 } from "lucide-react";
import { useServerStore } from "@/stores/servers";
import { useChannelStore } from "@/stores/channels";
import { useVoiceStore } from "@/stores/voice";
import { useAuthStore } from "@/stores/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateChannelDialog } from "@/components/channels/create-channel-dialog";
import { CreateCategoryDialog } from "@/components/channels/create-category-dialog";
import { InviteDialog } from "@/components/channels/invite-dialog";
import { VoicePanel } from "@/components/voice/voice-panel";
import { VoiceUser } from "@/components/voice/voice-user";
import { UserSettingsModal } from "@/components/settings/user-settings-modal";
import { ServerSettingsModal } from "@/components/settings/server-settings-modal";
import { useMemberStore } from "@/stores/members";
import { cn } from "@/lib/utils";
import { resolveUploadUrl } from "@/lib/api";
import type { Channel, CategoryWithChannels } from "@migo/shared";

interface ChannelSidebarProps {
  serverId: string;
}

export function ChannelSidebar({ serverId }: ChannelSidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const leaveServer = useServerStore((s) => s.leaveServer);
  const deleteServer = useServerStore((s) => s.deleteServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const channelList = useChannelStore((s) => s.channelList);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const user = useAuthStore((s) => s.user);

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const server = servers.find((s) => s.id === serverId);
  const isOwner = server?.ownerId === user?.id;

  const fetchMembers = useMemberStore((s) => s.fetchMembers);

  useEffect(() => {
    fetchChannels(serverId);
    fetchMembers(serverId);
  }, [serverId, fetchChannels, fetchMembers]);

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleLeave = async () => {
    await leaveServer(serverId);
    setActiveServer(null);
  };

  const handleDelete = async () => {
    await deleteServer(serverId);
    setActiveServer(null);
  };

  const voiceChannelId = useVoiceStore((s) => s.currentChannelId);
  const channelUsers = useVoiceStore((s) => s.channelUsers);
  const joinVoice = useVoiceStore((s) => s.joinChannel);

  const unreadChannels = useChannelStore((s) => s.unreadChannels);
  const markRead = useChannelStore((s) => s.markRead);

  const ChannelItem = ({ channel }: { channel: Channel }) => {
    const isVoice = channel.type === "voice";
    const isInThisVoice = voiceChannelId === channel.id;
    const isUnread = unreadChannels.has(channel.id);

    const handleClick = () => {
      if (isVoice) {
        if (!isInThisVoice) {
          joinVoice(channel.id, serverId);
        }
        setActiveChannel(channel.id);
      } else {
        setActiveChannel(channel.id);
        if (isUnread) markRead(channel.id, "");
      }
    };

    // Get participants for this voice channel (visible to everyone)
    const participants = isVoice
      ? Object.values(channelUsers[channel.id] ?? {})
      : [];

    return (
      <div>
        <button
          onClick={handleClick}
          className={cn(
            "flex items-center gap-x-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            activeChannelId === channel.id && "bg-muted text-foreground",
            isInThisVoice && "text-green-500",
            isUnread && "text-foreground font-semibold",
          )}
        >
          {isVoice ? (
            <Volume2 className="h-4 w-4 shrink-0 opacity-50" />
          ) : (
            <Hash className="h-4 w-4 shrink-0 opacity-50" />
          )}
          <span className="truncate">{channel.name}</span>
          {isUnread && (
            <span className="ml-auto w-2 h-2 rounded-full bg-primary shrink-0" />
          )}
        </button>
        {participants.length > 0 && (
          <div className="ml-4 mt-0.5 space-y-0.5">
            {participants.map((p) => (
              <VoiceUser key={p.userId} user={p} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const CategorySection = ({ category }: { category: CategoryWithChannels }) => {
    const isCollapsed = collapsedCategories.has(category.id);
    return (
      <div className="mt-4">
        <button
          onClick={() => toggleCategory(category.id)}
          className="flex items-center gap-0.5 px-1 w-full text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span className="truncate">{category.name}</span>
        </button>
        {!isCollapsed && (
          <div className="mt-0.5 space-y-0.5 pl-1">
            {category.channels.map((ch) => (
              <ChannelItem key={ch.id} channel={ch} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col w-60 bg-card">
        {/* Server header dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center px-4 h-12 border-b-2 border-border hover:bg-muted/50 transition-colors">
              <span className="font-semibold truncate">{server?.name}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-auto" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuItem onClick={() => setShowInvite(true)}>
              <Link className="h-4 w-4" />
              Invite People
            </DropdownMenuItem>
            {isOwner && (
              <>
                <DropdownMenuItem onClick={() => setShowServerSettings(true)}>
                  <Settings className="h-4 w-4" />
                  Server Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateChannel(true)}>
                  <Plus className="h-4 w-4" />
                  Create Channel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateCategory(true)}>
                  <Plus className="h-4 w-4" />
                  Create Category
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Server
                </DropdownMenuItem>
              </>
            )}
            {!isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLeave}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Leave Server
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Channel list */}
        <ScrollArea className="flex-1">
          <div className="px-2 py-2">
            {/* Uncategorized channels */}
            {channelList?.uncategorized.map((ch) => (
              <ChannelItem key={ch.id} channel={ch} />
            ))}

            {/* Categories with channels */}
            {channelList?.categories.map((cat) => (
              <CategorySection key={cat.id} category={cat} />
            ))}
          </div>
        </ScrollArea>

        {/* Voice panel */}
        <VoicePanel />

        {/* User panel */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-card">
          <div className="w-8 h-8 rounded-full bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center text-xs font-semibold">
            {user?.avatarUrl ? (
              <img src={resolveUploadUrl(user.avatarUrl)!} className="w-8 h-8 rounded-full object-cover" alt="" />
            ) : (
              user?.displayName?.charAt(0).toUpperCase() || "?"
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.username}</p>
          </div>
          <button
            onClick={() => setShowUserSettings(true)}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="User Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CreateChannelDialog
        open={showCreateChannel}
        onOpenChange={setShowCreateChannel}
        serverId={serverId}
      />
      <CreateCategoryDialog
        open={showCreateCategory}
        onOpenChange={setShowCreateCategory}
        serverId={serverId}
      />
      <InviteDialog
        open={showInvite}
        onOpenChange={setShowInvite}
        serverId={serverId}
      />
      {showUserSettings && (
        <UserSettingsModal onClose={() => setShowUserSettings(false)} />
      )}
      {showServerSettings && server && (
        <ServerSettingsModal
          server={server}
          onClose={() => setShowServerSettings(false)}
        />
      )}
    </>
  );
}
