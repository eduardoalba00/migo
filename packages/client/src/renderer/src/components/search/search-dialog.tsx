import { useState, useCallback, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { SEARCH_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";
import { useChannelStore } from "@/stores/channels";

interface SearchResult {
  id: string;
  channelId: string;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  content: string;
  createdAt: string;
}

interface SearchDialogProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ serverId, open, onOpenChange }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const data = await api.get<SearchResult[]>(
          buildRoute(SEARCH_ROUTES.SEARCH, { serverId }) + `?q=${encodeURIComponent(q)}`,
        );
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [serverId],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleResultClick = (result: SearchResult) => {
    setActiveChannel(result.channelId);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50" onClick={() => onOpenChange(false)}>
      <div className="w-full max-w-lg bg-card rounded-lg shadow-xl border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isSearching && (
            <p className="text-xs text-muted-foreground px-4 py-3">Searching...</p>
          )}
          {!isSearching && query && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-3">No results found</p>
          )}
          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => handleResultClick(result)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm">{result.author.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(result.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{result.content}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
