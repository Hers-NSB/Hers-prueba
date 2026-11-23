import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { operatingIncomeSeries, usd } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };

export default function FinanceCharts({ data, range, agencyByDay }) {
  const title = "Resultado operativo";
  const points = operatingIncomeSeries(range, data, agencyByDay);

  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    {points.length ? <>
      <div className="hf-chart-scroll" role="region" aria-label="Fechas del resultado operativo" tabIndex={0}>
        <div className="hf-chart" style={{ minWidth: 66 + points.length * 52 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={points} maxBarSize={56}
              margin={{ top: 16, right: 12, bottom: 0, left: 0 }} accessibilityLayer aria-label={title}>
              <CartesianGrid stroke="var(--hf-line)" vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="date" interval={0} tickMargin={5}
                tickFormatter={(value) => shortDate.format(value)} tick={axis} axisLine={false} tickLine={false} />
              <YAxis width={48} tickFormatter={(value) => axisMoney.format(value)} tick={axis} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke="var(--hf-line)" />
              <Tooltip cursor={{ fill: "var(--hf-line)", opacity: 0.25 }}
                contentStyle={{ background: "var(--hf-bg)", border: "1px solid var(--hf-line)", borderRadius: 8 }}
                labelStyle={{ color: "var(--hf-ink)" }} labelFormatter={(value) => longDate.format(value)}
                filterNull={false}
                formatter={(value) => [usd(value), "Ingreso"]} isAnimationActive={false} />
              <Bar dataKey="income" name="Ingreso" fill="var(--hf-accent)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="hf-chart-legend"><span>Ingreso</span></div>
    </> : <p className="hf-trend-empty">Sin actividad operativa en este período</p>}
  </section>;
}
