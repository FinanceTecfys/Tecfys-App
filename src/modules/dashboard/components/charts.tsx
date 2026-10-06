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
 *
 * Drill-down: a slice or point may carry an `href` (the loan book filtered to
 * the contracts behind it); clicking its bar / sector / legend row opens it.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
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
/** Bars of a neutral count (not a loss): the first categorical slot, as in the ranked bars. */
const NEUTRAL = "#3987e5";

const AXIS = { stroke: "#235a40", tick: { fill: "#94a3b8", fontSize: 11 }, tickLine: false } as const;
const GRID = { stroke: "#123422", strokeDasharray: "3 3", vertical: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#0c2618", border: "1px solid #1a4530", borderRadius: 8, fontSize: 12, color: "#e8f0ea" },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e8f0ea" },
  cursor: { fill: "rgba(0,247,161,0.06)" },
} as const;

/** A chart segment, optionally linked to the loan book filtered to it; `color` overrides its palette slot. */
export type DrillSlice = AggregateSlice & { href?: string; color?: string };

/**
 * What the amounts are. Money (the default) is the outstanding principal the
 * dashboard charts; "count" is a number of items (Pipeline), named by `measure`.
 */
export interface Measure {
  unit?: "money" | "count";
  /** Name of the measure in tooltips, e.g. "Scorings". */
  measure?: string;
}

const fmtCount = (v: number) => Math.round(v).toLocaleString("es-ES");
const fmtAmount = (v: number, unit: Measure["unit"]) => (unit === "count" ? fmtCount(v) : fmtEur(v));

/** Status colours from the validated categorical palette, for charts whose slices mean good / waiting / bad. */
export const STATUS_COLORS = { positive: "#199e70", waiting: "#c98500", negative: "#e66767" } as const;

/** Click handler for the i-th mark, and its cursor, when the data carries links. */
function useDrillDown(data: readonly { href?: string }[]) {
  const router = useRouter();
  const linked = data.some((d) => d.href);
  return {
    cursor: linked ? "pointer" : undefined,
    onClick: linked
      ? (_item: unknown, index: number) => {
          const href = data[index]?.href;
          if (href) router.push(href);
        }
      : undefined,
  };
}

/** Recharts types the tooltip item loosely; every chart here feeds it a slice. */
const slice = (item: unknown) => (item as { payload: AggregateSlice }).payload;

const sliceColor = (s: DrillSlice, i: number) => s.color ?? (s.key === "__other__" ? OTHER : CATEGORICAL[i % CATEGORICAL.length]);
const compactEur = (v: number) =>
  Math.abs(v) >= 1000 ? `${Math.round(v / 1000).toLocaleString("es-ES")}k` : Math.round(v).toLocaleString("es-ES");

/** Horizontal bars: one nominal dimension ranked by amount (no legend needed). */
export function RankedBarChart({ data, height = 520, unit = "money", measure = "Principal pendiente" }: { data: DrillSlice[]; height?: number } & Measure) {
  const drill = useDrillDown(data);
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }} barCategoryGap={4}>
        <CartesianGrid {...GRID} vertical horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={unit === "count" ? fmtCount : compactEur} allowDecimals={unit !== "count"} axisLine={false} />
        <YAxis type="category" dataKey="label" width={160} {...AXIS} axisLine={false} interval={0}
          tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)} />
        <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtAmount(Number(value), unit)} · ${fmtPct(slice(item).share, 1)}`, measure]} />
        <Bar dataKey="amount" fill={CATEGORICAL[0]} radius={[0, 4, 4, 0]} maxBarSize={14} {...drill} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars over an ordered dimension: size tiers take the ordinal ramp. */
export function BucketBarChart({ data, height = 260 }: { data: DrillSlice[]; height?: number }) {
  const drill = useDrillDown(data);
  if (data.every((d) => d.amount === 0)) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} axisLine={false} />
        <YAxis {...AXIS} tickFormatter={compactEur} axisLine={false} width={52} />
        <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtEur(Number(value))} · ${slice(item).count} contratos`, "Principal pendiente"]} />
        <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={56} {...drill}>
          {data.map((d, i) => (
            <Cell key={d.key} fill={ORDINAL[i % ORDINAL.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut + its own legend, so identity never rests on colour alone. */
export function DonutChart({
  data,
  total,
  height = 210,
  unit = "money",
  centerLabel = "pendiente",
}: { data: DrillSlice[]; total: number; height?: number; centerLabel?: string } & Pick<Measure, "unit">) {
  const drill = useDrillDown(data);
  if (data.length === 0) return <EmptyChart />;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="#071a0f" strokeWidth={2} {...drill}>
              {data.map((d, i) => (
                <Cell key={d.key} fill={sliceColor(d, i)} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP} cursor={false} formatter={(value, name, item) => [`${fmtAmount(Number(value), unit)} · ${fmtPct(slice(item).share, 1)}`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-sm font-semibold text-slate-100">{fmtAmount(total, unit)}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => {
          const content = (
            <>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sliceColor(d, i) }} />
              <span className="min-w-0 flex-1 truncate text-slate-300">{d.label}</span>
              <span className="num text-slate-400">{fmtPct(d.share, 1)}</span>
              <span className="num w-20 text-right text-slate-200">{fmtAmount(d.amount, unit)}</span>
            </>
          );
          return d.href ? (
            <li key={d.key}>
              <Link href={d.href} className="flex items-center gap-2 hover:[&>span]:text-mint-400" title={`Ver contratos: ${d.label}`}>{content}</Link>
            </li>
          ) : (
            <li key={d.key} className="flex items-center gap-2">{content}</li>
          );
        })}
      </ul>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number | null;
  href?: string;
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
export function MonthlyBarChart({
  data,
  height = 240,
  unit = "money",
  measure = "Default del mes",
  tone = "loss",
}: { data: SeriesPoint[]; height?: number; tone?: "neutral" | "loss" } & Measure) {
  const drill = useDrillDown(data);
  if (data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} axisLine={false} minTickGap={16} />
        <YAxis {...AXIS} axisLine={false} width={58} tickFormatter={unit === "count" ? fmtCount : compactEur} allowDecimals={unit !== "count"} />
        <Tooltip {...TOOLTIP} formatter={(value) => [fmtAmount(Number(value), unit), measure]} />
        <Bar dataKey="value" fill={tone === "neutral" ? NEUTRAL : LOSS} radius={[4, 4, 0, 0]} maxBarSize={28} {...drill} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <p className="py-10 text-center text-sm text-slate-500">Sin datos en el periodo seleccionado.</p>;
}
