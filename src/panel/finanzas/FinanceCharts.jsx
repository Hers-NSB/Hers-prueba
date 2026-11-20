import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { dailyFinance, usd } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };
const dayMs = 86_400_000;

function salesSeries(points) {
  const series = [];
  for (const point of points.filter(({ crm }) => crm !== null)) {
    const previous = series.at(-1);
    if (previous && point.date - previous.date > dayMs) {
      series.push({ date: previous.date + dayMs, crm: null });
    }
    series.push(point);
  }
  return series;
}

function TrendCard({ title, subtitle, points, emptyText, sales = false }) {
  const day = points[0]?.date;
  const dates = points.length === 1 ? [day] : undefined;
  const domain = points.length === 1 ? [day - dayMs, day + dayMs] : ["dataMin", "dataMax"];
  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    <p>{subtitle}</p>
    {points.length ? <div className="hf-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={points} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
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
            formatter={(value, name, item) => [usd(value),
              item.dataKey === "profit" && item.payload.provisional ? `${name} (provisional)` : name]} />
          {!sales && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {sales ? <Line dataKey="crm" name="Total del reporte CRM" stroke="var(--hf-accent)"
            strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
            : <>
              <Bar dataKey="income" name="Ingresos" fill="var(--hf-accent)" maxBarSize={28}
                radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="expenses" name="Gastos" fill="var(--hf-expense)" maxBarSize={28}
                radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="profit" name="Utilidad operativa" stroke="var(--hf-profit)" strokeWidth={2.5}
                dot={{ r: 3 }} isAnimationActive={false} />
            </>}
        </ComposedChart>
      </ResponsiveContainer>
    </div> : <p className="hf-trend-empty">{emptyText}</p>}
  </section>;
}

export default function FinanceCharts({ data }) {
  const points = dailyFinance(data);
  return <div className="hf-trends">
    <TrendCard title="Resultado operativo" subtitle="Ingresos de la agencia, gastos y utilidad por día · USD"
      points={points.filter(({ profit }) => profit !== null)} emptyText="Sin actividad operativa en este período" />
    <TrendCard title="Evolución de ventas" subtitle="Total diario del reporte CRM de AgencyKey · USD"
      points={salesSeries(points)} emptyText="Sin ventas importadas en este período" sales />
  </div>;
}
