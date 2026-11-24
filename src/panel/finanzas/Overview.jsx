import { lazy, Suspense } from "react";
import { ArrowUpRight, BarChart3, CircleDollarSign, Wallet } from "lucide-react";
import { investmentTotal, netSales, salesProfit, summarize, usd } from "./finance";
import "./finanzas.css";

const FinanceCharts = lazy(() => import("./FinanceCharts"));

export default function Overview({ data, range, children, monthly = false }) {
  const { movements, sales } = data;
  const totals = summarize(data);
  const investment = investmentTotal(movements, totals);
  const net = netSales(sales, movements);
  const cards = [
    ...(!monthly ? [["Bóveda de HERS", data.balance, Wallet, "income"]] : []),
    ["Inversión", investment, ArrowUpRight, "expenses"],
    ["Ganancia", salesProfit(net, investment), CircleDollarSign, "profit"],
    ["Ventas netas", net, BarChart3, "sales"],
  ];
  return <>
    <h2>Resumen del período</h2>
    <div className="hf-kpis hf-overview-kpis">{cards.map(([label, value, Icon, tone]) => <article key={label} data-tone={tone}>
      <span className="hf-kpi-label"><Icon size={18} aria-hidden="true" />{label}</span>
      <strong>{usd(value)}</strong>
    </article>)}</div>
    <Suspense fallback={<section className="hf-section hf-trend" aria-busy="true">
      <h2>Resultado operativo</h2><div className="hf-chart" />
    </section>}>
      <FinanceCharts data={data} range={range} />
    </Suspense>
    {children}
  </>;
}
