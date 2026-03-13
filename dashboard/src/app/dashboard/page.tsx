"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  ShieldAlert,
  Target,
  Search,
  ChevronRight,
  Bell,
  Cpu,
} from "lucide-react";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function DashboardPage() {
  const router = useRouter();
  const timelineData = [
    { time: "09:27", network: 1200, auth: 400 },
    { time: "10:27", network: 1800, auth: 500 },
    { time: "11:27", network: 2200, auth: 700 },
    { time: "12:27", network: 2400, auth: 850 },
    { time: "13:27", network: 2300, auth: 800 },
    { time: "14:27", network: 1900, auth: 600 },
    { time: "15:27", network: 1500, auth: 500 },
    { time: "16:27", network: 1300, auth: 450 },
    { time: "17:27", network: 1200, auth: 400 },
    { time: "18:27", network: 1250, auth: 420 },
    { time: "19:27", network: 1350, auth: 480 },
    { time: "20:27", network: 1500, auth: 550 },
  ];

  const severityData = [
    { name: "Info", count: 480, color: "#059669" },
    { name: "Warning", count: 420, color: "#d97706" },
    { name: "Critical", count: 300, color: "#be123c" },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        .ambient-glow { 
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: -1;
            background: #f1f5f9;
        }
        .bg-gradient-vibrant { background: #059669; }
        .bg-gradient-indigo { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); }
        .heatmap-cell { transition: all 0.2s ease; }
        .heatmap-cell:hover { transform: translateY(-1px); border-color: #94a3b8; }
      `}} />

      <div className="ambient-glow"></div>
      <div className="min-h-screen flex flex-col font-display bg-background-light text-slate-900 -mx-4 lg:-mx-6 -mt-4 lg:-mt-6">

        <main className="flex-1 space-y-6 p-5">
          {/* HEADER SECTION */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="grid grid-cols-12">
              {/* Global Ingestion */}
              <div className="col-span-12 lg:col-span-4 p-6 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between">
                <div>
                  <p className="text-[10px] font-black text-primary uppercase tracking-[0.1em] mb-1">Global Ingestion</p>
                  <p className="text-xs text-slate-400 mb-6">Total Events Ingested</p>
                  <div className="flex items-baseline gap-2 mb-2">
                    <h2 className="text-5xl font-black text-emerald-600 tracking-tight">24.8K</h2>
                  </div>
                  <div className="flex items-center gap-1 text-primary text-sm font-bold">
                    <TrendingUp className="w-4 h-4" /> +12% vs last 24h
                  </div>
                </div>
              </div>
              {/* Incident Response */}
              <div className="col-span-12 md:col-span-6 lg:col-span-3 p-6 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-6">Incident Response</p>
                <div className="flex items-center gap-4 mb-2">
                  <span className="text-4xl font-black text-slate-800 tracking-tight">18</span>
                  <span className="text-xs font-black text-red-500 uppercase tracking-wider">3 Critical</span>
                </div>
                <p className="text-xs text-slate-400 mt-auto">Active alerts requiring triage</p>
              </div>
              {/* Risk Assessment */}
              <div className="col-span-12 md:col-span-6 lg:col-span-3 p-6 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-6">Risk Assessment</p>
                <div className="flex items-center gap-4 mb-2">
                  <span className="text-4xl font-black text-slate-800 tracking-tight">38</span>
                  <span className="text-xs font-black text-red-400 uppercase tracking-wider">-8% Improvement</span>
                </div>
                <p className="text-xs text-slate-400 mt-auto">Overall infrastructure risk score</p>
              </div>
              {/* AI Precision */}
              <div className="col-span-12 md:col-span-6 lg:col-span-2 p-6 bg-slate-50/50 border-b lg:border-b-0 border-slate-200 flex flex-col">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-6">AI Precision</p>
                <div className="flex items-center gap-4 mb-2">
                  <span className="text-4xl font-black text-primary tracking-tight">94.3%</span>
                </div>
                <p className="text-xs text-slate-400 mt-auto">Model Accuracy</p>
              </div>
            </div>
            {/* Bottom Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-slate-200">
              <div className="p-6 border-r border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-2">Ingest Rate</p>
                <p className="text-3xl font-black text-slate-800 tracking-tight">42/s</p>
              </div>
              <div className="p-6 border-r border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-2">MTTR</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-black text-slate-800 tracking-tight">14m</p>
                  <p className="text-[10px] font-bold text-red-500">-2m delta</p>
                </div>
              </div>
              <div className="p-6 border-r border-slate-200">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-2">SLA Uptime</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-black text-slate-800 tracking-tight">99.94%</p>
                  <p className="text-[10px] font-bold text-primary">+0.01%</p>
                </div>
              </div>
              <div className="p-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] mb-2">AI Detect</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-black text-slate-800 tracking-tight">3%</p>
                  <p className="text-[10px] font-bold text-slate-400">Total traffic</p>
                </div>
              </div>
            </div>
          </section>

          {/* MIDDLE SECTION */}
          <section className="grid grid-cols-12 gap-4">
            {/* Event Volume Timeline */}
            <div className="col-span-12 lg:col-span-8 bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-slate-800">Event Volume Timeline</h3>
                <div className="flex gap-2">
                  <button className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded">Live</button>
                  <button className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded">24h</button>
                  <button className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded">7d</button>
                </div>
              </div>
              <div className="flex-1 min-h-[16rem] w-full bg-slate-50 rounded-lg p-4 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                    <defs>
                      <linearGradient id="colorNetwork" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ color: '#64748b', marginBottom: '4px' }}
                    />
                    <Area type="monotone" dataKey="network" name="Events" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorNetwork)" />
                  </AreaChart>
                </ResponsiveContainer>

                <div className="absolute left-6 top-6 space-y-2 pointer-events-none">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span> EVENTS TIMELINE
                  </div>
                </div>
              </div>
            </div>

            {/* Alert Severity Breakdown */}
            <div className="col-span-12 lg:col-span-4 bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col">
              <h3 className="font-bold text-slate-800 mb-6">Alert Severity Breakdown</h3>
              <div className="flex flex-col flex-1">
                <div className="w-full flex-1 min-h-[12rem] mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={severityData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                      <RechartsTooltip
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {severityData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full space-y-3 mt-auto">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2 font-semibold text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"></span> Critical
                    </div>
                    <span className="font-bold">25%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2 font-semibold text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span> Warning
                    </div>
                    <span className="font-bold">35%</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2 font-semibold text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-primary"></span> Info
                    </div>
                    <span className="font-bold">40%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* MITRE ATT&CK Heatmap */}
            <div className="col-span-12 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-slate-800 mb-6">MITRE ATT&CK Heatmap</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Initial Access</p>
                  <div className="heatmap-cell h-12 bg-rose-50 border-l-4 border-rose-300 flex items-center px-3 rounded text-[10px] font-bold text-rose-900">Valid Accounts</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Phishing</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Public Apps</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Execution</p>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Command Line</div>
                  <div className="heatmap-cell h-12 bg-red-50 border-l-4 border-red-300 flex items-center px-3 rounded text-[10px] font-bold text-red-700">PowerShell</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Native API</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Persistence</p>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Registry Run</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Create Account</div>
                  <div className="heatmap-cell h-12 bg-amber-50 border-l-4 border-amber-400 flex items-center px-3 rounded text-[10px] font-bold text-amber-800">Scheduled Task</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Priv Escalation</p>
                  <div className="relative">
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)] z-10"></span>
                    <div className="heatmap-cell h-12 bg-rose-50 border-l-4 border-rose-400 flex items-center px-3 rounded text-[10px] font-bold text-rose-900 relative">Access Token</div>
                  </div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Sudo</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Bypass UAC</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Discovery</p>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">System Info</div>
                  <div className="heatmap-cell h-12 bg-amber-50 border-l-4 border-amber-300 flex items-center px-3 rounded text-[10px] font-bold text-amber-900">Network Share</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Process Enum</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Lateral Movement</p>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Remote Desktop</div>
                  <div className="heatmap-cell h-12 bg-rose-50 border-l-4 border-rose-300 flex items-center px-3 rounded text-[10px] font-bold text-rose-900">Valid Accounts</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">SSH Hijacking</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Exfiltration</p>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">Cloud Storage</div>
                  <div className="heatmap-cell h-12 bg-slate-50 border-l-4 border-slate-200 flex items-center px-3 rounded text-[10px] font-bold text-slate-400">USB Media</div>
                  <div className="heatmap-cell h-12 bg-rose-50 border-l-4 border-rose-300 flex items-center px-3 rounded text-[10px] font-bold text-rose-900">Valid Accounts</div>
                </div>
              </div>
            </div>

            {/* Risky Entities and Top Techniques */}
            <div className="col-span-12 lg:col-span-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-slate-800 mb-6">Risky Entities</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                      <span className="material-symbols-outlined text-sm">person</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">jsmith_admin</p>
                      <p className="text-[10px] text-slate-500">Domain Controller Access</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-red-500 font-black">94</span>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Risk Score</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                      <span className="material-symbols-outlined text-sm">dns</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">prod-db-01</p>
                      <p className="text-[10px] text-slate-500">Unusual SQL Query Volume</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-amber-500 font-black">82</span>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Risk Score</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                      <span className="material-symbols-outlined text-sm">laptop_mac</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">m_thompson_laptop</p>
                      <p className="text-[10px] text-slate-500">Failed MFA attempts (x15)</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-amber-500 font-black">76</span>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Risk Score</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-slate-800 mb-6">Top Log Sources</h3>
              <div className="space-y-5">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-600">AWS CloudTrail</span>
                    <span className="text-slate-800">4.2 GB/day</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: "85%" }}></div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-600">CrowdStrike EDR</span>
                    <span className="text-slate-800">3.1 GB/day</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: "65%" }}></div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-600">Cisco Firewall</span>
                    <span className="text-slate-800">2.8 GB/day</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: "58%" }}></div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-slate-600">Microsoft Entra ID</span>
                    <span className="text-slate-800">1.4 GB/day</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: "30%" }}></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* BOTTOM SECTION */}
          <section className="grid grid-cols-12 gap-4">
            {/* Recent Investigations Table */}
            <div className="col-span-12 lg:col-span-9 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden p-5">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center -mx-5 -mt-5 mb-5">
                <h3 className="font-bold text-slate-800">Recent Investigations</h3>
                <button className="text-xs font-bold text-primary hover:underline">View All Investigations</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase">
                    <tr>
                      <th className="px-6 py-4 rounded-tl-lg">ID</th>
                      <th className="px-6 py-4">Alert Name</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Priority</th>
                      <th className="px-6 py-4">Owner</th>
                      <th className="px-6 py-4 rounded-tr-lg">Time</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-slate-100">
                    <tr onClick={() => router.push('/investigations/INC-8821')} className="hover:bg-slate-50/50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 font-mono text-slate-500">INC-8821</td>
                      <td className="px-6 py-4 font-bold text-slate-800">Lateral Movement detected via SMB</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-sm font-bold border border-amber-200">In Progress</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1 text-red-500 font-bold">
                          <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"></span> Critical
                        </span>
                      </td>
                      <td className="px-6 py-4">R. Simmons</td>
                      <td className="px-6 py-4 text-slate-400">2m ago</td>
                    </tr>
                    <tr onClick={() => router.push('/investigations/INC-8819')} className="hover:bg-slate-50/50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 font-mono text-slate-500">INC-8819</td>
                      <td className="px-6 py-4 font-bold text-slate-800">Brute force attempt on SSH</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-slate-50 text-slate-600 rounded-sm font-bold border border-slate-200">Queued</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1 text-amber-500 font-bold">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span> High
                        </span>
                      </td>
                      <td className="px-6 py-4">Unassigned</td>
                      <td className="px-6 py-4 text-slate-400">14m ago</td>
                    </tr>
                    <tr onClick={() => router.push('/investigations/INC-8815')} className="hover:bg-slate-50/50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 font-mono text-slate-500">INC-8815</td>
                      <td className="px-6 py-4 font-bold text-slate-800">Suspicious PowerShell Download</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-sm font-bold border border-emerald-200">Resolved</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1 text-slate-400 font-bold">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span> Low
                        </span>
                      </td>
                      <td className="px-6 py-4">AI Agent 01</td>
                      <td className="px-6 py-4 text-slate-400">1h ago</td>
                    </tr>
                    <tr onClick={() => router.push('/investigations/INC-8812')} className="hover:bg-slate-50/50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 font-mono text-slate-500">INC-8812</td>
                      <td className="px-6 py-4 font-bold text-slate-800">Multiple Sudo failures</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-sm font-bold border border-emerald-200">Resolved</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1 text-amber-500 font-bold">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span> Med
                        </span>
                      </td>
                      <td className="px-6 py-4">M. Chen</td>
                      <td className="px-6 py-4 text-slate-400">3h ago</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI Agent Pipeline Stats */}
            <div className="col-span-12 lg:col-span-3 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl shadow-xl bg-gradient-indigo text-white border-none p-5">
                <div className="flex items-center gap-2 mb-4 text-emerald-400">
                  <Cpu className="w-4 h-4" />
                  <h3 className="font-bold text-sm tracking-tight text-white">AI Agent Pipeline</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">Active Agents</span>
                    <span className="text-lg font-bold">14</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">Automated Triages</span>
                    <span className="text-lg font-bold">1,422</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">False Positive Reduction</span>
                    <span className="text-sm font-bold text-emerald-400">+42%</span>
                  </div>
                  <div className="pt-4 border-t border-slate-700/50">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-slate-400 mb-2">
                      <span>Core Processing</span>
                      <span className="text-white">88%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full transition-all duration-1000" style={{ width: "88%" }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                <h3 className="text-xs font-black text-slate-400 uppercase mb-4">Pipeline Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_#059669]"></span>
                    <span className="text-xs font-bold text-slate-700">Threat Ingest Service</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_#059669]"></span>
                    <span className="text-xs font-bold text-slate-700">Enrichment Engine</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_#059669]"></span>
                    <span className="text-xs font-bold text-slate-700">Pattern Recognition</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
                    <span className="text-xs font-bold text-slate-700">Deep Correlation (Delayed)</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="mt-auto px-6 py-4 border-t border-slate-200 bg-white text-[10px] font-bold text-slate-400 uppercase tracking-widest flex justify-between">
          <div>© 2026 CYBER-PREMIUM ENTERPRISE SECURITY PLATFORM</div>
          <div className="flex gap-4">
            <Link className="hover:text-primary transition-colors" href="#">Documentation</Link>
            <Link className="hover:text-primary transition-colors" href="#">API Status</Link>
            <Link className="hover:text-primary transition-colors" href="#">Security Advisories</Link>
          </div>
        </footer>
      </div>
    </>
  );
}
