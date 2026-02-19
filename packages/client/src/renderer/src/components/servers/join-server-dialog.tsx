import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerStore } from "@/stores/servers";

interface JoinServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

export function JoinServerDialog({ open, onOpenChange, onBack }: JoinServerDialogProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const joinServer = useServerStore((s) => s.joinServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    try {
      const server = await joinServer(code.trim());
      setActiveServer(server.id);
      toast.success(`Joined "${server.name}"!`);
      setCode("");
      onOpenChange(false);
    } catch {
      toast.error("Failed to join server. Invalid or expired invite code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden">
        <DialogHeader className="pt-6 px-6 relative">
          {onBack && (
            <button
              onClick={onBack}
              className="absolute left-6 top-6 p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <DialogTitle className="text-xl text-center font-bold">Join a server</DialogTitle>
          <DialogDescription className="text-center">
            Enter an invite code to join an existing server.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-code" className="uppercase text-xs font-bold text-muted-foreground">Invite code</Label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter invite code"
              autoFocus
              className="bg-muted/50 border-0 focus-visible:ring-0"
            />
          </div>
          <div className="bg-muted/30 -mx-6 px-6 py-4 mt-6 flex justify-end">
            <Button type="submit" disabled={!code.trim() || loading}>
              {loading ? "Joining..." : "Join Server"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
