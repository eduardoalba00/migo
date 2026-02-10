import { useState } from "react";
import { Plus, ArrowLeftRight } from "lucide-react";
import { useServerStore } from "@/stores/servers";
import { useChannelStore } from "@/stores/channels";
import { useWorkspaceStore } from "@/stores/workspace";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateServerDialog } from "@/components/servers/create-server-dialog";
import { JoinServerDialog } from "@/components/servers/join-server-dialog";
import { cn } from "@/lib/utils";

export function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const clearChannels = useChannelStore((s) => s.clearChannels);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const handleServerClick = async (serverId: string) => {
    if (serverId === activeServerId) return;
    setActiveServer(serverId);
    setActiveChannel(null);
    clearChannels();
    await fetchChannels(serverId);
  };

  return (
    <>
      <div className="flex flex-col items-center w-[72px] bg-background py-3 gap-2 border-r border-border overflow-y-auto">
        {servers.map((server) => (
          <Tooltip key={server.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleServerClick(server.id)}
                className={cn(
                  "relative w-12 h-12 rounded-[24px] bg-secondary flex items-center justify-center text-foreground font-semibold text-lg transition-all hover:rounded-[16px] hover:bg-primary",
                  activeServerId === server.id && "rounded-[16px] bg-primary",
                )}
              >
                {activeServerId === server.id && (
                  <div className="absolute left-[-8px] w-1 h-10 bg-foreground rounded-r-full" />
                )}
                {server.name.charAt(0).toUpperCase()}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{server.name}</TooltipContent>
          </Tooltip>
        ))}

        <Separator className="w-8 my-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowCreate(true)}
              className="w-12 h-12 rounded-[24px] bg-secondary flex items-center justify-center text-green-500 transition-all hover:rounded-[16px] hover:bg-green-500 hover:text-white"
            >
              <Plus className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Create a server</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowJoin(true)}
              className="w-12 h-12 rounded-[24px] bg-secondary flex items-center justify-center text-green-500 transition-all hover:rounded-[16px] hover:bg-green-500 hover:text-white text-sm font-bold"
            >
              Join
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Join a server</TooltipContent>
        </Tooltip>

        <div className="mt-auto" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setActiveWorkspace(null)}
              className="w-12 h-12 rounded-[24px] bg-secondary flex items-center justify-center text-muted-foreground transition-all hover:rounded-[16px] hover:bg-accent hover:text-foreground"
            >
              <ArrowLeftRight className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Switch workspace</TooltipContent>
        </Tooltip>
      </div>

      <CreateServerDialog open={showCreate} onOpenChange={setShowCreate} />
      <JoinServerDialog open={showJoin} onOpenChange={setShowJoin} />
    </>
  );
}
