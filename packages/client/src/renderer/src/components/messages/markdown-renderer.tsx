import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Code blocks (``` ... ```) - handled first to prevent inner parsing
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    return `<pre class="bg-muted rounded-md p-3 my-1 overflow-x-auto"><code class="text-xs font-mono">${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code class="bg-muted rounded px-1 py-0.5 text-xs font-mono">${code}</code>`;
  });

  // Bold (**...**)
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic (*...*)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Strikethrough (~~...~~)
  result = result.replace(/~~(.+?)~~/g, '<span class="line-through">$1</span>');

  // Spoilers (||...||)
  result = result.replace(
    /\|\|(.+?)\|\|/g,
    '<span class="migo-spoiler bg-muted-foreground/80 text-transparent hover:bg-transparent hover:text-foreground rounded px-0.5 transition-colors cursor-pointer" onclick="this.classList.toggle(\'revealed\')">$1</span>',
  );

  // Links (https://... or http://...)
  result = result.replace(
    /(?<!\w)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>',
  );

  // Block quotes (> ...)
  result = result.replace(
    /^&gt; (.+)$/gm,
    '<div class="border-l-4 border-muted-foreground/30 pl-3 my-1 text-muted-foreground">$1</div>',
  );

  // @mentions
  result = result.replace(
    /@(\w+)/g,
    '<span class="bg-primary/20 text-primary rounded px-0.5 font-medium cursor-pointer hover:underline">@$1</span>',
  );

  return result;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = parseInline(content);

  return (
    <span
      className={cn("break-words whitespace-pre-wrap", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
