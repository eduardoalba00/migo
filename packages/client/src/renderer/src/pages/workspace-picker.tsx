import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AddWorkspaceDialog } from "@/components/workspaces/add-workspace-dialog";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";

export function WorkspacePicker() {
  const [showAdd, setShowAdd] = useState(false);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);

  return (
    <>
      <div className="flex flex-1 items-center justify-center bg-background">
        <Card className="w-[440px] shadow-xl overflow-hidden">
          <CardHeader className="text-center">
            <CardTitle>Welcome to Migo</CardTitle>
            <CardDescription>
              {workspaces.length > 0
                ? "Select a workspace or add a new one."
                : "Add a workspace to connect to a Migo server."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspaces.length > 0 && (
              <div className="space-y-2">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => switchWorkspace(workspace.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors",
                      "hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-lg">
                      {workspace.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{workspace.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{workspace.url}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWorkspace(workspace.id);
                      }}
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </button>
                ))}
              </div>
            )}

            {workspaces.length > 0 && <Separator />}

            <div className="flex justify-center">
              <Button variant={workspaces.length > 0 ? "outline" : "default"} onClick={() => setShowAdd(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AddWorkspaceDialog open={showAdd} onOpenChange={setShowAdd} />
    </>
  );
}
