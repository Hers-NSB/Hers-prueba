import {
  Area, AreaChart, CartesianGrid, Dot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { dailyFinance, usdPayment } from "./finance";

const shortDate = new Intl.DateTimeFormat("es-VE", { month: "short", day: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const axisMoney = new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 1 });
const axis = { fill: "var(--hf-muted)", fontSize: 11 };

export default function FinanceCharts({ data, range, agencyByDay, pendingDays }) {
  const title = "Resultado operativo";
  const recorded = new Map(dailyFinance(data, agencyByDay).map((point) => [point.date, point]));
  const points = [];
  for (let date = Date.parse(range.from); date <= Date.parse(range.to); date += 86_400_000) {
    const point = recorded.get(date);
    const isPending = pendingDays?.has(new Date(date).toISOString().slice(0, 10));
    points.push({ date, income: isPending ? null : point?.income ?? null, expenses: point?.expenses ?? 0 });
  }
  const highest = points.reduce((maximum, { income }) => income == null ? maximum : Math.max(maximum, income), -Infinity);
  const maxDates = new Set(points.filter(({ income }) => income === highest).map(({ date }) => date));

  return <section className="hf-section hf-trend">
    <h2>{title}</h2>
    {points.length ? <>
      <div className="hf-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={points} baseValue={0}
            margin={{ top: 16, right: 12, bottom: 0, left: 0 }} accessibilityLayer aria-label={title}>
            <CartesianGrid stroke="var(--hf-line)" vertical={false} strokeDasharray="3 5" />
            <XAxis dataKey="date" interval="preserveStartEnd" minTickGap={10} tickMargin={5}
              tickFormatter={(value) => shortDate.format(value)} tick={axis} axisLine={false} tickLine={false} />
            <YAxis width={48} tickFormatter={(value) => axisMoney.format(value)} tick={axis} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="var(--hf-line)" />
            <Tooltip cursor={{ stroke: "var(--hf-muted)", strokeDasharray: "3 5" }}
              contentStyle={{ background: "var(--hf-bg)", border: "1px solid var(--hf-line)", borderRadius: 8, whiteSpace: "normal" }}
              labelStyle={{ color: "var(--hf-ink)" }} labelFormatter={(value) => longDate.format(value)}
              filterNull={false}
              formatter={(value, name, item) => [usdPayment(value),
                item.dataKey === "income" && maxDates.has(item.payload.date) ? "Ingreso · Máximo" : name]}
              isAnimationActive={false} />
            <Area type="linear" dataKey="income" name="Ingreso" stroke="var(--hf-accent)" strokeWidth={2}
              fill="var(--hf-accent)" fillOpacity={0.24} isAnimationActive={false}
              dot={({ key, cx, cy, payload }) => maxDates.has(payload.date)
                ? <Dot key={key} cx={cx} cy={cy} r={4} fill="var(--hf-profit)" stroke="var(--hf-bg)" /> : null} />
            <Area type="linear" dataKey="expenses" name="Inversión" stroke="var(--hf-expense)" strokeWidth={2}
              fill="var(--hf-expense)" fillOpacity={0.32} isAnimationActive={false}
              dot={points.length === 1 && points[0].expenses !== 0} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="hf-chart-legend"><span>Ingreso</span><span>Inversión</span>{maxDates.size > 0 && <span>Máximo</span>}</div>
    </> : <p className="hf-trend-empty">Sin actividad operativa en este período</p>}
  </section>;
}
