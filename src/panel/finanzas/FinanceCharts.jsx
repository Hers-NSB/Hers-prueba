import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { dailyFinance, usd } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };

function DateTick({ x, y, payload, byDate }) {
  const { date, income, expenses, highlight } = byDate.get(payload.value);
  return <g transform={`translate(${x},${y})`} textAnchor="middle" fontSize={11}>
    <text y={12} fill="var(--hf-ink)">{shortDate.format(date)}</text>
    <text y={29} fill={highlight?.color ?? "var(--hf-accent)"}>{usd(income)}{highlight && ` · ${highlight.label}`}</text>
    <text y={45} fill="var(--hf-expense)">{usd(expenses)}</text>
  </g>;
}

export default function FinanceCharts({ data, agencyByDay, pendingDays }) {
  const title = "Resultado operativo";
  const points = dailyFinance(data, agencyByDay).map((point) =>
    pendingDays?.has(new Date(point.date).toISOString().slice(0, 10)) ? { ...point, income: null } : point)
    .filter(({ income, expenses }) => income !== null || expenses !== null);
  const incomes = points.flatMap(({ income }) => income == null ? [] : [income]);
  const highest = Math.max(...incomes);
  const lowest = Math.min(...incomes);
  const byDate = new Map(points.map((point) => {
    let highlight;
    if (point.income === highest) highlight = { label: highest === lowest ? "Máx./mín." : "Máx.", color: "var(--hf-profit)" };
    else if (point.income === lowest) highlight = { label: "Mín.", color: "#f4d59d" };
    return [point.date, { ...point, highlight }];
  }));

  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    {points.length ? <>
      <div className="hf-chart-scroll" tabIndex={0} aria-label="Gráfico por fecha">
        <div className="hf-chart" style={{ minWidth: Math.max(270, points.length * 110 + 60) }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={points} stackOffset="sign" maxBarSize={56}
              margin={{ top: 16, right: 16, bottom: 0, left: 0 }} accessibilityLayer aria-label={title}>
              <CartesianGrid stroke="var(--hf-line)" vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="date" interval={0} height={56} tick={<DateTick byDate={byDate} />}
                axisLine={false} tickLine={false} />
              <YAxis width={48} tickFormatter={(value) => axisMoney.format(value)} tick={axis} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke="var(--hf-line)" />
              <Tooltip cursor={{ fill: "var(--hf-line)", opacity: 0.25 }}
                contentStyle={{ background: "var(--hf-bg)", border: "1px solid var(--hf-line)", borderRadius: 8 }}
                labelStyle={{ color: "var(--hf-ink)" }} labelFormatter={(value) => longDate.format(value)}
                formatter={(value) => usd(value)} isAnimationActive={false} />
              <Bar dataKey="income" name="Ingreso" stackId="operating" fill="var(--hf-accent)" isAnimationActive={false}>
                {points.map(({ date }) => <Cell key={date} fill={byDate.get(date).highlight?.color ?? "var(--hf-accent)"} />)}
              </Bar>
              <Bar dataKey="expenses" name="Inversión" stackId="operating" fill="var(--hf-expense)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="hf-chart-legend"><span>Ingreso</span><span>Inversión</span></div>
    </> : <p className="hf-trend-empty">Sin actividad operativa en este período</p>}
  </section>;
}
