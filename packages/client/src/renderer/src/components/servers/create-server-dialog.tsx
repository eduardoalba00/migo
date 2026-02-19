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

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
}

export function CreateServerDialog({ open, onOpenChange, onBack }: CreateServerDialogProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const createServer = useServerStore((s) => s.createServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const server = await createServer(name.trim());
      setActiveServer(server.id);
      toast.success(`Server "${server.name}" created!`);
      setName("");
      onOpenChange(false);
    } catch {
      toast.error("Failed to create server");
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
          <DialogTitle className="text-xl text-center font-bold">Create a server</DialogTitle>
          <DialogDescription className="text-center">
            Give your new server a name. You can always change it later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="px-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-name" className="uppercase text-xs font-bold text-muted-foreground">Server name</Label>
            <Input
              id="server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Server"
              maxLength={100}
              autoFocus
              className="bg-muted/50 border-0 focus-visible:ring-0"
            />
          </div>
          <div className="bg-muted/30 -mx-6 px-6 py-4 mt-6 flex justify-end">
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
