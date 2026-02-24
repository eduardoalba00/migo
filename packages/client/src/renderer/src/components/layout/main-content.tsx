import { useChannelStore } from "@/stores/channels";
import { useServerStore } from "@/stores/servers";
import { useVoiceStore } from "@/stores/voice";
import { ChannelHeader } from "@/components/channels/channel-header";
import { MessageList } from "@/components/messages/message-list";
import { MessageInput } from "@/components/messages/message-input";
import { MembersSidebar } from "@/components/members/members-sidebar";
import { ScreenShareViewer } from "@/components/voice/screen-share-viewer";
import { Hash, Volume2 } from "lucide-react";

export function MainContent() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const channelList = useChannelStore((s) => s.channelList);
  const screenShareTracks = useVoiceStore((s) => s.screenShareTracks);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentChannelId);
  const channelUsers = useVoiceStore((s) => s.channelUsers);

  // Find the active channel
  let activeChannel = null;
  if (channelList && activeChannelId) {
    activeChannel =
      channelList.uncategorized.find((ch) => ch.id === activeChannelId) ||
      channelList.categories
        .flatMap((cat) => cat.channels)
        .find((ch) => ch.id === activeChannelId) ||
      null;
  }

  if (!activeServerId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground space-y-2">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Hash className="h-8 w-8" />
          </div>
          <p className="text-lg font-bold text-foreground">Select a server</p>
          <p className="text-sm">Choose a server from the sidebar to get started</p>
        </div>
      </div>
    );
  }

  if (!activeChannel) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground space-y-2">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Hash className="h-8 w-8" />
          </div>
          <p className="text-lg font-bold text-foreground">Select a channel</p>
          <p className="text-sm">Choose a channel from the sidebar to start chatting</p>
        </div>
      </div>
    );
  }

  const isVoiceChannel = activeChannel.type === "voice";

  const getUserName = (userId: string): string => {
    if (!currentVoiceChannelId) return "Someone";
    const users = channelUsers[currentVoiceChannelId];
    if (users?.[userId]) {
      return users[userId].displayName || users[userId].username;
    }
    return "Someone";
  };

  // Voice channel view
  if (isVoiceChannel) {
    // Compute all users with screenSharing: true in the current voice channel
    const currentChannelUsers = currentVoiceChannelId
      ? channelUsers[currentVoiceChannelId] ?? {}
      : {};
    const streamingUserIds = Object.values(currentChannelUsers)
      .filter((u) => u.screenSharing)
      .map((u) => u.userId);
    const hasScreenShares = streamingUserIds.length > 0;

    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChannelHeader channel={activeChannel} />
          {hasScreenShares ? (
            <ScreenShareViewer
              tracks={screenShareTracks}
              streamingUserIds={streamingUserIds}
              getUserName={getUserName}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center text-muted-foreground space-y-3">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                  <Volume2 className="h-8 w-8" />
                </div>
                <p className="text-lg font-bold text-foreground">{activeChannel.name}</p>
                <p className="text-sm">No one is sharing their screen</p>
              </div>
            </div>
          )}
        </div>
        <MembersSidebar serverId={activeServerId} />
      </div>
    );
  }

  // Text channel view
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        <ChannelHeader channel={activeChannel} />
        <MessageList channelId={activeChannel.id} channelName={activeChannel.name} />
        <MessageInput channelId={activeChannel.id} channelName={activeChannel.name} />
      </div>
      <MembersSidebar serverId={activeServerId} />
    </div>
  );
}
