"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShortcutEntry {
  keys: string;
  label: string;
  category: string;
}

function KeyBadge({ k }: { k: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-mono text-[10px] font-semibold text-muted-foreground">
      {k}
    </kbd>
  );
}

function formatKeys(keys: string) {
  const parts = keys.split("+").flatMap((p) =>
    p.trim().split(" ").map((k) => {
      if (k === "ctrl" || k === "meta") return "⌘";
      if (k === "shift") return "⇧";
      if (k === "alt") return "⌥";
      return k.toUpperCase();
    }),
  );
  return parts.map((k, i) => (
    <span key={i} className="inline-flex items-center gap-0.5">
      {i > 0 && <span className="mx-0.5 text-[9px] text-muted-foreground">then</span>}
      <KeyBadge k={k} />
    </span>
  ));
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutEntry[];
}) {
  // Group by category
  const grouped = shortcuts.reduce<Record<string, ShortcutEntry[]>>(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category].push(s);
      return acc;
    },
    {},
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-card p-0 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-primary" />
              <DialogPrimitive.Title className="text-sm font-semibold">
                Keyboard Shortcuts
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            List of keyboard shortcuts available in the CLIF dashboard.
          </DialogPrimitive.Description>
          <div className="max-h-[60vh] overflow-y-auto p-5 space-y-5">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {category}
                </h3>
                <div className="space-y-1.5">
                  {items.map((s) => (
                    <div
                      key={s.keys}
                      className="flex items-center justify-between rounded-md px-2 py-1.5"
                    >
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                      <div className="flex items-center gap-1">
                        {formatKeys(s.keys)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t px-5 py-2.5 text-center">
            <span className="text-[10px] text-muted-foreground">
              Press <KeyBadge k="?" /> anywhere to show this panel
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
