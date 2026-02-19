import { Plus, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
}

export function AddServerDialog({ open, onOpenChange, onCreateServer, onJoinServer }: AddServerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden">
        <DialogHeader className="pt-6 px-6">
          <DialogTitle className="text-xl text-center font-bold">Add a server</DialogTitle>
          <DialogDescription className="text-center">
            Create your own server or join an existing one.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6 space-y-2">
          <button
            onClick={onCreateServer}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Plus className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold">Create a server</p>
              <p className="text-xs text-muted-foreground">Start a new community</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
          <button
            onClick={onJoinServer}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowRight className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold">Join a server</p>
              <p className="text-xs text-muted-foreground">Enter an invite code</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
