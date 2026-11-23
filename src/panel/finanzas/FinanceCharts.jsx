import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { dailyFinance, usd } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };

export default function FinanceCharts({ data, agencyByDay, pendingDays }) {
  const title = "Resultado operativo";
  const points = dailyFinance(data, agencyByDay).map((point) =>
    pendingDays?.has(new Date(point.date).toISOString().slice(0, 10)) ? { ...point, income: null } : point)
    .filter(({ income, expenses }) => income !== null || expenses !== null);
  const highest = points.reduce((maximum, { income }) => income == null ? maximum : Math.max(maximum, income), -Infinity);
  const maxDates = new Set(points.filter(({ income }) => income === highest).map(({ date }) => date));

  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    {points.length ? <>
      <div className="hf-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={points} stackOffset="sign" maxBarSize={56}
            margin={{ top: 16, right: 12, bottom: 0, left: 0 }} accessibilityLayer aria-label={title}>
            <CartesianGrid stroke="var(--hf-line)" vertical={false} strokeDasharray="3 5" />
            <XAxis dataKey="date" interval="preserveStartEnd" minTickGap={10} tickMargin={5}
              tickFormatter={(value) => shortDate.format(value)} tick={axis} axisLine={false} tickLine={false} />
            <YAxis width={48} tickFormatter={(value) => axisMoney.format(value)} tick={axis} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="var(--hf-line)" />
            <Tooltip cursor={{ fill: "var(--hf-line)", opacity: 0.25 }}
              contentStyle={{ background: "var(--hf-bg)", border: "1px solid var(--hf-line)", borderRadius: 8 }}
              labelStyle={{ color: "var(--hf-ink)" }} labelFormatter={(value) => longDate.format(value)}
              formatter={(value, name, item) => [usd(value),
                item.dataKey === "income" && maxDates.has(item.payload.date) ? "Ingreso · Máximo" : name]}
              isAnimationActive={false} />
            <Bar dataKey="income" name="Ingreso" stackId="operating" fill="var(--hf-accent)" isAnimationActive={false}>
              {points.map(({ date }) => <Cell key={date} fill={maxDates.has(date) ? "var(--hf-profit)" : "var(--hf-accent)"} />)}
            </Bar>
            <Bar dataKey="expenses" name="Inversión" stackId="operating" fill="var(--hf-expense)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="hf-chart-legend"><span>Ingreso</span><span>Inversión</span>{maxDates.size > 0 && <span>Máximo</span>}</div>
    </> : <p className="hf-trend-empty">Sin actividad operativa en este período</p>}
  </section>;
}
