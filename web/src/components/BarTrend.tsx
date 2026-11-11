import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthLabel } from '@/lib/format';

/**
 * Single-series monthly bar chart (dataviz skill): thin bars, 4px rounded data-ends
 * anchored to the baseline, recessive horizontal grid, per-bar hover tooltip.
 * Bar color comes from --chart-bar (validated per theme); the hovered bar lifts to
 * brand yellow. Single series → no legend; the card title names it.
 */
export function BarTrend({
  data,
  valueKey,
  format,
  height = 260,
  tickFormat,
}: {
  data: { month: string; [k: string]: number | string }[];
  valueKey: string;
  format: (n: number) => string;
  tickFormat?: (n: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%" onMouseLeave={() => setActive(null)}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
          <XAxis
            dataKey="month"
            tickFormatter={monthLabel}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: 'var(--muted)', fontSize: 12, fontFamily: 'IBM Plex Sans' }}
            tickFormatter={tickFormat ?? ((n: number) => String(n))}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }}
            content={({ active: a, payload, label }) =>
              a && payload?.length ? (
                <div className="rounded-lg border border-hairline bg-surface px-3 py-2 shadow-xl">
                  <p className="text-xs text-muted">{monthLabel(String(label))} {String(label).slice(0, 4)}</p>
                  <p className="num mt-0.5 text-sm font-semibold text-strong">{format(Number(payload[0]!.value))}</p>
                </div>
              ) : null
            }
          />
          <Bar
            dataKey={valueKey}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
            isAnimationActive={false}
            onMouseEnter={(_, i) => setActive(i)}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={i === active ? '#FCD535' : 'var(--chart-bar)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
