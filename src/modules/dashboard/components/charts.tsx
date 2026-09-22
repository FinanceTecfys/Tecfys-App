"use client";

/**
 * Chart primitives for the dashboard. Presentation only: every number arrives
 * already aggregated by src/modules/dashboard/domain/analytics.ts.
 *
 * Palettes are the validated instances for our dark surface (#071A0F):
 *  - categorical, fixed order, never cycled (8 slots, tail folds into "Otros")
 *  - ordinal single-hue ramp for the size tiers, which are ordered
 * Both were checked with the dataviz validator (lightness band, chroma floor,
 * CVD separation, normal-vision floor, contrast).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtEur, fmtPct } from "@/lib/format";
import type { AggregateSlice } from "../domain/analytics";

export const CATEGORICAL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const ORDINAL = ["#0b6b4f", "#109070", "#17b083", "#3ccb9e", "#67e0ba", "#9bf0d4"];
const OTHER = "#6b7280";
const MINT = "#00f7a1";
const LOSS = "#e66767";

const AXIS = { stroke: "#235a40", tick: { fill: "#94a3b8", fontSize: 11 }, tickLine: false } as const;
const GRID = { stroke: "#123422", strokeDasharray: "3 3", vertical: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#0c2618", border: "1px solid #1a4530", borderRadius: 8, fontSize: 12, color: "#e8f0ea" },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e8f0ea" },
  cursor: { fill: "rgba(0,247,161,0.06)" },
} as const;

/** Recharts types the tooltip item loosely; every chart here feeds it a slice. */
const slice = (item: unknown) => (item as { payload: AggregateSlice }).payload;

const sliceColor = (s: AggregateSlice, i: number) => (s.key === "__other__" ? OTHER : CATEGORICAL[i % CATEGORICAL.length]);
const compactEur = (v: number) =>
  Math.abs(v) >= 1000 ? `${Math.round(v / 1000).toLocaleString("es-ES")}k` : Math.round(v).toLocaleString("es-ES");

/** Horizontal bars: one nominal dimension ranked by amount (no legend needed). */
export function RankedBarChart({ data, height = 520 }: { data: AggregateSlice[]; height?: number }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barCategoryGap={4}>
        <CartesianGrid {...GRID} vertical horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={compactEur} axisLine={false} />
        <YAxis type="category" dataKey="label" width={160} {...AXIS} axisLine={false} interval={0}
          tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)} />
        <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtEur(Number(value))} · ${fmtPct(slice(item).share, 1)}`, "Principal pendiente"]} />
        <Bar dataKey="amount" fill={CATEGORICAL[0]} radius={[0, 4, 4, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars over an ordered dimension: size tiers take the ordinal ramp. */
export function BucketBarChart({ data, height = 260 }: { data: AggregateSlice[]; height?: number }) {
  if (data.every((d) => d.amount === 0)) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} axisLine={false} />
        <YAxis {...AXIS} tickFormatter={compactEur} axisLine={false} width={52} />
        <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtEur(Number(value))} · ${slice(item).count} contratos`, "Principal pendiente"]} />
        <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d, i) => (
            <Cell key={d.key} fill={ORDINAL[i % ORDINAL.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut + its own legend, so identity never rests on colour alone. */
export function DonutChart({ data, total, height = 210 }: { data: AggregateSlice[]; total: number; height?: number }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="#071a0f" strokeWidth={2}>
              {data.map((d, i) => (
                <Cell key={d.key} fill={sliceColor(d, i)} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP} cursor={false} formatter={(value, name, item) => [`${fmtEur(Number(value))} · ${fmtPct(slice(item).share, 1)}`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-sm font-semibold text-slate-100">{fmtEur(total)}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">pendiente</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sliceColor(d, i) }} />
            <span className="min-w-0 flex-1 truncate text-slate-300">{d.label}</span>
            <span className="num text-slate-400">{fmtPct(d.share, 1)}</span>
            <span className="num w-20 text-right text-slate-200">{fmtEur(d.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number | null;
}

/** Monthly line for a single measure (one series: the card title names it). */
export function MonthlyLineChart({
  data,
  format,
  tone = "mint",
  height = 240,
}: {
  data: SeriesPoint[];
  format: "percent" | "money";
  tone?: "mint" | "loss";
  height?: number;
}) {
  if (data.length === 0) return <EmptyChart />;
  const color = tone === "mint" ? MINT : LOSS;
  const fmt = (v: number) => (format === "percent" ? fmtPct(v, 1) : fmtEur(v));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} axisLine={false} minTickGap={16} />
        <YAxis {...AXIS} axisLine={false} width={58} tickFormatter={(v: number) => (format === "percent" ? `${(v * 100).toFixed(0)}%` : compactEur(v))} />
        <Tooltip {...TOOLTIP} cursor={{ stroke: "#1a4530" }} formatter={(value) => [fmt(Number(value)), format === "percent" ? "Tasa" : "Importe"]} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#071a0f" }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Monthly bars, for an amount that is booked in discrete months. */
export function MonthlyBarChart({ data, height = 240 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} axisLine={false} minTickGap={16} />
        <YAxis {...AXIS} axisLine={false} width={58} tickFormatter={compactEur} />
        <Tooltip {...TOOLTIP} formatter={(value) => [fmtEur(Number(value)), "Default del mes"]} />
        <Bar dataKey="value" fill={LOSS} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <p className="py-10 text-center text-sm text-slate-500">Sin datos en el periodo seleccionado.</p>;
}
