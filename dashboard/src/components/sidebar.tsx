"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Radio,
  Search,
  ShieldAlert,
  FolderSearch,
  Bot,
  Radar,
  Lock,
  FileText,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_SECTIONS = [
  {
    label: "MONITOR",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/live-feed", label: "Live Feed", icon: Radio },
      { href: "/alerts", label: "Alerts", icon: ShieldAlert },
    ],
  },
  {
    label: "INVESTIGATE",
    items: [
      { href: "/search", label: "Search", icon: Search },
      { href: "/investigations", label: "Investigations", icon: FolderSearch },

    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { href: "/threat-intel", label: "Threat Intel", icon: Radar },
      { href: "/ai-agents", label: "AI Agents", icon: Bot },
    ],
  },
  {
    label: "EVIDENCE",
    items: [
      { href: "/evidence", label: "Chain of Custody", icon: Lock },
      { href: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { href: "/system", label: "System Health", icon: Activity },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        role="navigation"
        aria-label="Main navigation"
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center border-b px-4">
          <Shield className="h-6 w-6 shrink-0 text-primary" />
          {!collapsed && (
            <span className="ml-2.5 text-base font-semibold tracking-tight">
              CLIF
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-3">
              {!collapsed && (
                <div className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {section.label}
                </div>
              )}
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const Icon = item.icon;

                const link = (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                }
                return link;
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-10 items-center justify-center border-t text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </aside>
    </TooltipProvider>
  );
}
