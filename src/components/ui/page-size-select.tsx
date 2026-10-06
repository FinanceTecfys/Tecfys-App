"use client";

import { useRouter } from "next/navigation";

/**
 * Rows-per-page selector of a listing. Each size is a URL the server built
 * (same filters, page 1), so choosing one is a plain navigation.
 */
export function PageSizeSelect({ value, options }: { value: number; options: { size: number; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-400">
      Mostrar
      <select
        value={value}
        onChange={(e) => {
          const next = options.find((o) => String(o.size) === e.target.value);
          if (next) router.push(next.href);
        }}
        aria-label="Filas por página"
        className="num rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-mint-500"
      >
        {options.map((o) => (
          <option key={o.size} value={o.size}>{o.size}</option>
        ))}
      </select>
      por página
    </label>
  );
}
