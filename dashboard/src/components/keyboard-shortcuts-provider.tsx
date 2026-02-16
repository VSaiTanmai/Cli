"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";

const SHORTCUT_MAP = [
  // Navigation — vim-style "g o" (go) sequences
  { keys: "g d", label: "Go to Dashboard", category: "Navigation" },
  { keys: "g l", label: "Go to Live Feed", category: "Navigation" },
  { keys: "g a", label: "Go to Alerts", category: "Navigation" },
  { keys: "g s", label: "Go to Search", category: "Navigation" },
  { keys: "g i", label: "Go to Investigations", category: "Navigation" },
  { keys: "g n", label: "Go to Attack Graph", category: "Navigation" },
  { keys: "g t", label: "Go to Threat Intel", category: "Navigation" },
  { keys: "g m", label: "Go to AI Agents", category: "Navigation" },
  { keys: "g e", label: "Go to Evidence", category: "Navigation" },
  { keys: "g r", label: "Go to Reports", category: "Navigation" },
  { keys: "g h", label: "Go to System Health", category: "Navigation" },
  { keys: "g x", label: "Go to Settings", category: "Navigation" },
  // Global
  { keys: "?", label: "Show keyboard shortcuts", category: "Global" },
  { keys: "/", label: "Focus search (when available)", category: "Global" },
];

export function KeyboardShortcutsProvider() {
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();

  const navigate = useCallback((path: string) => router.push(path), [router]);

  useKeyboardShortcuts([
    { id: "help", keys: "?", label: "Show shortcuts", category: "Global", action: () => setHelpOpen(true) },
    { id: "nav-dashboard", keys: "g d", label: "Dashboard", category: "Navigation", action: () => navigate("/dashboard") },
    { id: "nav-live", keys: "g l", label: "Live Feed", category: "Navigation", action: () => navigate("/live-feed") },
    { id: "nav-alerts", keys: "g a", label: "Alerts", category: "Navigation", action: () => navigate("/alerts") },
    { id: "nav-search", keys: "g s", label: "Search", category: "Navigation", action: () => navigate("/search") },
    { id: "nav-inv", keys: "g i", label: "Investigations", category: "Navigation", action: () => navigate("/investigations") },

    { id: "nav-threat", keys: "g t", label: "Threat Intel", category: "Navigation", action: () => navigate("/threat-intel") },
    { id: "nav-agents", keys: "g m", label: "AI Agents", category: "Navigation", action: () => navigate("/ai-agents") },
    { id: "nav-evidence", keys: "g e", label: "Evidence", category: "Navigation", action: () => navigate("/evidence") },
    { id: "nav-reports", keys: "g r", label: "Reports", category: "Navigation", action: () => navigate("/reports") },
    { id: "nav-system", keys: "g h", label: "System Health", category: "Navigation", action: () => navigate("/system") },
    { id: "nav-settings", keys: "g x", label: "Settings", category: "Navigation", action: () => navigate("/settings") },
    {
      id: "focus-search",
      keys: "/",
      label: "Focus search",
      category: "Global",
      action: () => {
        const el = document.querySelector<HTMLInputElement>(
          '[data-search-input="true"]',
        );
        if (el) {
          el.focus();
          el.select();
        }
      },
    },
  ]);

  return (
    <KeyboardShortcutsDialog
      open={helpOpen}
      onOpenChange={setHelpOpen}
      shortcuts={SHORTCUT_MAP}
    />
  );
}
