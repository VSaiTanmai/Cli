"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { timeAgo } from "@/lib/utils";
import {
  FileText,
  FileWarning,
  Briefcase,
  Code2,
  Shield,
  Radar,
  Download,
  Plus,
  Clock,
  CheckCircle2,
} from "lucide-react";
import reportsData from "@/lib/mock/reports.json";
import type { ReportTemplate, Report } from "@/lib/types";

const templates = reportsData.templates as ReportTemplate[];
const history = reportsData.history as Report[];

const TEMPLATE_ICONS: Record<string, React.ElementType> = {
  FileWarning: FileWarning,
  Briefcase: Briefcase,
  Code: Code2,
  Shield: Shield,
  Radar: Radar,
};

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            AI-generated investigation reports and compliance documentation
          </p>
        </div>
        <Button className="gap-1.5">
          <Plus className="h-4 w-4" /> Generate Report
        </Button>
      </div>

      {/* Report Templates */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Templates
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {templates.map((tmpl) => {
            const Icon = TEMPLATE_ICONS[tmpl.icon] ?? FileText;
            return (
              <Card
                key={tmpl.id}
                className="cursor-pointer transition-colors hover:bg-muted/20"
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-primary/10 p-2">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-medium">{tmpl.name}</h3>
                      <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                        {tmpl.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Report History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-primary" />
            Report History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left bg-muted/30">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    ID
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Title
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[120px]">
                    Template
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">
                    Created
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[70px]">
                    Pages
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[70px]">
                    Size
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[40px]">
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((report) => (
                  <tr
                    key={report.id}
                    className="border-b border-border/30 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {report.id}
                    </td>
                    <td className="px-4 py-3 text-sm">{report.title}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px]">
                        {report.template}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(report.created)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {report.pages}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {report.size}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="low"
                        className="text-[10px]"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {report.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
