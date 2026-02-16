import { useState } from "react";
import { Plus, ArrowLeftRight, MessageCircle } from "lucide-react";
import { useServerStore } from "@/stores/servers";
import { useChannelStore } from "@/stores/channels";
import { useWorkspaceStore } from "@/stores/workspace";
import { useDmStore } from "@/stores/dms";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CreateServerDialog } from "@/components/servers/create-server-dialog";
import { JoinServerDialog } from "@/components/servers/join-server-dialog";
import { resolveUploadUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const clearChannels = useChannelStore((s) => s.clearChannels);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const setActiveDm = useDmStore((s) => s.setActiveDm);

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const isDmMode = !activeServerId;

  const handleServerClick = async (serverId: string) => {
    if (serverId === activeServerId) return;
    setActiveDm(null);
    setActiveServer(serverId);
    setActiveChannel(null);
    clearChannels();
    await fetchChannels(serverId);
  };

  const handleDmsClick = () => {
    setActiveServer(null);
    setActiveChannel(null);
    clearChannels();
  };

  return (
    <>
      <div className="flex flex-col items-center w-[64px] bg-sidebar py-3 gap-2 overflow-y-auto">
        {/* DM button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="group relative flex items-center justify-center w-full">
              <div
                className={cn(
                  "absolute left-0 bg-sidebar-primary rounded-r-full w-[4px] transition-all",
                  isDmMode ? "h-[32px]" : "h-[8px] group-hover:h-[18px]",
                  !isDmMode && "opacity-0 group-hover:opacity-100",
                )}
              />
              <button
                onClick={handleDmsClick}
                className={cn(
                  "relative h-[42px] w-[42px] rounded-[12px] bg-card flex items-center justify-center text-foreground transition-all",
                  "hover:rounded-[8px] hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
                  isDmMode &&
                    "rounded-[8px] bg-sidebar-primary text-sidebar-primary-foreground",
                )}
              >
                <MessageCircle className="h-5 w-5" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Direct Messages</TooltipContent>
        </Tooltip>

        {servers.map((server) => {
          const isActive = activeServerId === server.id;
          return (
            <Tooltip key={server.id}>
              <TooltipTrigger asChild>
                <div className="group relative flex items-center justify-center w-full">
                  {/* Pill indicator */}
                  <div
                    className={cn(
                      "absolute left-0 bg-sidebar-primary rounded-r-full w-[4px] transition-all",
                      isActive ? "h-[32px]" : "h-[8px] group-hover:h-[18px]",
                      !isActive && "opacity-0 group-hover:opacity-100",
                    )}
                  />
                  <button
                    onClick={() => handleServerClick(server.id)}
                    className={cn(
                      "relative h-[42px] w-[42px] rounded-[12px] bg-card flex items-center justify-center text-foreground font-semibold text-lg transition-all",
                      "hover:rounded-[8px] hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
                      isActive &&
                        "rounded-[8px] bg-sidebar-primary text-sidebar-primary-foreground",
                    )}
                  >
                    {server.iconUrl ? (
                      <img
                        src={resolveUploadUrl(server.iconUrl)!}
                        alt=""
                        className="h-[42px] w-[42px] rounded-[inherit] object-cover"
                      />
                    ) : (
                      server.name.charAt(0).toUpperCase()
                    )}
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{server.name}</TooltipContent>
            </Tooltip>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="group relative flex items-center justify-center w-full">
              <button
                onClick={() => setShowCreate(true)}
                className="h-[42px] w-[42px] rounded-[12px] bg-card flex items-center justify-center text-primary transition-all hover:rounded-[8px] hover:bg-primary hover:text-primary-foreground"
              >
                <Plus className="h-6 w-6" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Create a server</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="group relative flex items-center justify-center w-full">
              <button
                onClick={() => setShowJoin(true)}
                className="h-[42px] w-[42px] rounded-[12px] bg-card flex items-center justify-center text-primary transition-all hover:rounded-[8px] hover:bg-primary hover:text-primary-foreground text-sm font-bold"
              >
                Join
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Join a server</TooltipContent>
        </Tooltip>

        <div className="mt-auto" />

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="group relative flex items-center justify-center w-full">
              <button
                onClick={() => setActiveWorkspace(null)}
                className="h-[42px] w-[42px] rounded-[12px] bg-card flex items-center justify-center text-muted-foreground transition-all hover:rounded-[8px] hover:bg-sidebar-accent hover:text-foreground"
              >
                <ArrowLeftRight className="h-5 w-5" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">Switch workspace</TooltipContent>
        </Tooltip>
      </div>

      <CreateServerDialog open={showCreate} onOpenChange={setShowCreate} />
      <JoinServerDialog open={showJoin} onOpenChange={setShowJoin} />
    </>
  );
}
