import { useEffect, useState } from "react";
import { Check, Copy, FileText, NotebookPen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "ascendara-game-notes:";

const TEMPLATES = [
  {
    id: "mods",
    label: "+ Mod Load Order",
    snippet: "## Mod Load Order\n1. \n2. \n3. \n",
  },
  {
    id: "controller",
    label: "+ Controller Config",
    snippet: "## Controller / Controls\n- Layout: \n- Sensitivity: \n- Bindings: \n",
  },
  {
    id: "checklist",
    label: "+ Quest / Boss Checklist",
    snippet: "## Checklist\n- [ ] \n- [ ] \n",
  },
  {
    id: "saves",
    label: "+ Save Location",
    snippet: "## Save Location\n- Path: \n- Backup note: \n",
  },
];

function loadNoteRecord(gameName) {
  if (!gameName) return { text: "", updatedAt: null };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${gameName}`);
    if (!raw) return { text: "", updatedAt: null };
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        text: typeof parsed.text === "string" ? parsed.text : "",
        updatedAt: parsed.updatedAt || null,
      };
    }
    return { text: String(raw), updatedAt: null };
  } catch {
    return { text: "", updatedAt: null };
  }
}

export default function NotesTab({ gameName }) {
  const [text, setText] = useState(() => loadNoteRecord(gameName).text);
  const [updatedAt, setUpdatedAt] = useState(() => loadNoteRecord(gameName).updatedAt);
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving"
  const [monospace, setMonospace] = useState(false);

  useEffect(() => {
    const loaded = loadNoteRecord(gameName);
    setText(loaded.text);
    setUpdatedAt(loaded.updatedAt);
    setSaveState("saved");
  }, [gameName]);

  useEffect(() => {
    if (!gameName) return undefined;
    const initial = loadNoteRecord(gameName).text;
    if (text === initial) return undefined;

    setSaveState("saving");
    const timer = setTimeout(() => {
      try {
        const now = Date.now();
        if (text.trim().length === 0) {
          localStorage.removeItem(`${STORAGE_PREFIX}${gameName}`);
          setUpdatedAt(null);
        } else {
          localStorage.setItem(
            `${STORAGE_PREFIX}${gameName}`,
            JSON.stringify({ text, updatedAt: now })
          );
          setUpdatedAt(now);
        }
        setSaveState("saved");
      } catch (error) {
        console.error("[NotesTab] Failed to save notes:", error);
        toast.error("Could not save notes to local storage");
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [gameName, text]);

  const appendTemplate = snippet => {
    setText(prev => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n\n${snippet}` : snippet;
    });
  };

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Notes copied to clipboard");
    } catch {
      toast.error("Failed to copy notes");
    }
  };

  const handleClear = () => {
    if (!text) return;
    setText("");
    toast.success("Notes cleared");
  };

  const lineCount = text ? text.split("\n").length : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 flex items-center gap-2 text-[1.375rem] font-semibold tracking-tight text-foreground">
            <NotebookPen className="h-5 w-5 text-primary" />
            Notes & Scratchpad
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Private local notes for {gameName}—auto-saved as you type.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonospace(prev => !prev)}
            className={cn(
              "rounded-[8px] border px-2.5 py-1.5 text-xs font-medium transition-colors",
              monospace
                ? "border-primary bg-primary font-semibold text-secondary shadow-sm"
                : "border-border/70 bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
            )}
          >
            Monospace
          </button>
          <Button
            size="sm"
            variant="outline"
            disabled={!text}
            onClick={handleCopy}
            className="h-8 gap-1.5 rounded-[8px] border-border/70 bg-card text-foreground hover:border-foreground/25"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!text}
            onClick={handleClear}
            className="h-8 gap-1.5 rounded-[8px] border-border/70 bg-card text-muted-foreground hover:border-red-500/40 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Quick template chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TEMPLATES.map(tpl => (
          <button
            key={tpl.id}
            type="button"
            onClick={() => appendTemplate(tpl.snippet)}
            className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            {tpl.label}
          </button>
        ))}
      </div>

      {/* Editor card */}
      <div className="overflow-hidden rounded-[12px] border border-border/70 bg-card">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Jot down mod load orders, controller settings, boss strategies, quest reminders, or save paths..."
          rows={12}
          className={cn(
            "min-h-[280px] w-full resize-y bg-transparent p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none",
            monospace && "font-mono text-[13px]"
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-background/40 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              {text.length} chars · {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-primary" />
            <span>
              {saveState === "saving"
                ? "Saving…"
                : updatedAt
                  ? `Saved ${new Date(updatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Auto-saves locally"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
