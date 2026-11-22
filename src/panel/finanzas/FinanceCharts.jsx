import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { dailyFinance, usd } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };
const dayMs = 86_400_000;

export default function FinanceCharts({ data, agencyByDay, pendingDays }) {
  const title = "Resultado operativo";
  const points = dailyFinance(data, agencyByDay).map((point) =>
    pendingDays?.has(new Date(point.date).toISOString().slice(0, 10)) ? { ...point, income: null } : point)
    .filter(({ income, expenses }) => income !== null || expenses !== null);
  const day = points[0]?.date;
  const dates = points.length === 1 ? [day] : undefined;
  const domain = points.length === 1 ? [day - dayMs, day + dayMs] : ["dataMin", "dataMax"];
  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    {points.length ? <div className="hf-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
          accessibilityLayer aria-label={title}>
          <CartesianGrid stroke="var(--hf-line)" vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="date" type="number" scale="time" domain={domain} ticks={dates}
            tickFormatter={(value) => shortDate.format(value)} tick={axis} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis width={48} tickFormatter={(value) => axisMoney.format(value)} tick={axis} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="var(--hf-line)" />
          <Tooltip cursor={{ stroke: "var(--hf-muted)", strokeDasharray: "3 4" }}
            contentStyle={{ background: "var(--hf-bg)", border: "1px solid var(--hf-line)", borderRadius: 8 }}
            labelStyle={{ color: "var(--hf-ink)" }}
            labelFormatter={(value) => longDate.format(value)}
            formatter={(value) => usd(value)} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {[
            ["expenses", "Inversión", "var(--hf-expense)"],
            ["income", "Ingreso", "var(--hf-accent)"],
          ].map(([dataKey, name, stroke]) => <Line key={dataKey} dataKey={dataKey} name={name} stroke={stroke}
            strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="hf-trend-empty">Sin actividad operativa en este período</p>}
  </section>;
}
