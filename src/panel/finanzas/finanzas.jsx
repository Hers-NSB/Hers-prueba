import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUpRight, BarChart3, CircleDollarSign, Clock, Plus, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { crmTotal, dateKey, financeBreakdown, hasOperatingAmounts, kinds, metricIf, monthRange, ONLYFANS, summarize, usd } from "./finance";
import Distribution from "./Distribution";
import "./finanzas.css";

const FinanceCharts = lazy(() => import("./FinanceCharts"));

const empty = { movements: [], sales: [], commissions: [], creators: [], platforms: [], members: [], rates: [], distributionSales: [], distributionPlans: [], sync: null };
const catalog = { platform: "Plataforma", creator: "Modelo", member: "Chatter" };
const catalogTables = { platform: "finance_platforms", creator: "finance_creators", member: "finance_members" };
const tabs = ["Resumen", "Movimientos", "Comisiones", "Empleados"];
const categories = ["Operación", "Marketing", "Software", "Producción", "Equipos", "Servicios"];
const pageSize = 500;

async function readRows(table, ordering, filter = (query) => query) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    let query = filter(supabase.from(table).select("*"));
    for (const column of ordering) query = query.order(column);
    const { data, error } = await query.range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function loadFinance({ from, to, creator, platform }) {
  const { data: allowed, error } = await supabase.rpc("finance_is_admin");
  if (error?.code === "42501" || !error && !allowed) return null;
  if (error) throw error;
  const inPeriod = (query) => {
    const dates = query.gte("day", from).lte("day", to);
    return creator ? dates.eq("creator_id", creator) : dates;
  };
  const onlyFans = !platform || platform === ONLYFANS;
  const [movements, distributionSales, commissions, creators, platforms, members, rates, sync, distributionPlans] =
    await Promise.all([
      readRows("finance_movements", ["day", "id"], (query) => platform ? inPeriod(query).eq("platform_id", platform) : inPeriod(query)),
      readRows("finance_agencykey_sales", ["day", "creator_id"], (query) => query.gte("day", from).lte("day", to)),
      onlyFans ? readRows("finance_commissions", ["day", "creator_id", "member_id"], inPeriod) : [],
      readRows("finance_creators", ["name", "id"]),
      readRows("finance_platforms", ["name", "id"]),
      readRows("finance_members", ["name", "id"]),
      readRows("finance_rates", ["effective_on", "member_id"]),
      readRows("finance_sync", ["source"]),
      readRows("finance_distribution_plans", ["effective_on", "revision"]),
    ]);
  const sales = onlyFans ? distributionSales.filter((row) => !creator || row.creator_id === creator) : [];
  return { movements, sales, commissions, creators, platforms, members, rates, distributionSales, distributionPlans, sync: sync.find((row) => row.source === "agencykey") };
}

export default function Finanzas() {
  const [filters, setFilters] = useState(() => ({ ...monthRange(), creator: "", platform: "" }));
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState(tabs[0]);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState("loading");
  const [editor, setEditor] = useState(null);

  useEffect(() => {
    if (!filters.from || !filters.to || filters.from > filters.to) return;
    let active = true;
    loadFinance(filters).then((result) => {
      if (!active) return;
      setData(result ?? empty);
      setState(result ? "ready" : "denied");
    }).catch((error) => {
      if (!active) return;
      console.error("Finanzas", error.code || error.message);
      setData(empty);
      setState("error");
    });
    return () => { active = false; };
  }, [filters, revision]);

  const updateFilters = (patch) => {
    setState("loading");
    setFilters((current) => ({ ...current, ...patch }));
  };
  const reload = () => { setState("loading"); refresh((value) => value + 1); };
  const invalid = !filters.from || !filters.to || filters.from > filters.to;
  const totals = summarize(data);

  return <section className="hf hf-finance" aria-label="Finanzas">
    <header className="hf-header">
      <div><h1>Finanzas</h1><p>Ventas de plataforma y resultados de la agencia</p></div>
      <div className="hf-sync">
        <Clock size={16} aria-hidden="true" />
        <div><strong>AgencyKey</strong><small>{data.sync
          ? <>Última importación correcta · {new Date(data.sync.last_success).toLocaleString("es-VE")}<br />Último día importado · {data.sync.through_day}</>
          : "Sin importaciones correctas"}</small></div>
        <button type="button" className="hf-icon" onClick={reload} aria-label="Actualizar la vista"><RefreshCw size={16} /></button>
      </div>
    </header>
    {state === "denied" ? <p role="alert" className="hf-notice">Tu cuenta no tiene acceso a Finanzas</p> : <>
      <nav className="hf-tabs" aria-label="Secciones de Finanzas">
        {tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      <div className="hf-filters">
        <label>Desde<input type="date" value={filters.from} onChange={(e) => updateFilters({ from: e.target.value })} /></label>
        <label>Hasta<input type="date" value={filters.to} onChange={(e) => updateFilters({ to: e.target.value })} /></label>
        <Choice label="Modelo" value={filters.creator} rows={data.creators} onChange={(creator) => updateFilters({ creator })} placeholder="Todos" />
        <Choice label="Plataforma" value={filters.platform} rows={data.platforms} onChange={(platform) => updateFilters({ platform })} placeholder="Todas" />
        <div className="hf-actions hf-presets">
          <button type="button" onClick={() => updateFilters(monthRange())}>Este mes</button>
          <button type="button" onClick={() => updateFilters(monthRange(-1))}>Mes anterior</button>
        </div>
      </div>
      {invalid && <p className="hf-notice" role="alert">Selecciona un período válido</p>}
      {!invalid && state === "loading" && <p className="hf-notice" role="status">Cargando Finanzas…</p>}
      {!invalid && state === "error" && <p className="hf-notice" role="alert">No se pudieron cargar los datos de Finanzas <button type="button" onClick={reload}>Reintentar</button></p>}
      {!invalid && state === "ready" && <>
        {tab === "Resumen" && <Overview totals={totals} data={data} onCreate={() => setEditor({ type: "movement" })} />}
        {tab === "Movimientos" && <Movements data={data} onEdit={(row) => setEditor({ type: "movement", row })} />}
        {tab === "Comisiones" && <Commissions data={data} onEdit={(row) => setEditor({ type: "rate", row })} />}
        {tab === "Empleados" && <Employees data={data} onCreate={(type) => setEditor({ type })}
          onDistributionSaved={(plan) => setData((current) => ({
            ...current,
            distributionPlans: [...current.distributionPlans, plan].sort((a, b) =>
              a.effective_on.localeCompare(b.effective_on) || a.revision - b.revision),
          }))} />}
      </>}
      {editor && <Editor editor={editor} data={data} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); reload(); }} />}
    </>}
  </section>;
}

function Choice({ label, value, rows, onChange, placeholder = "Sin asignar", required = false }) {
  return <label>{label}<select required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {rows.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
  </select></label>;
}

function Table({ headings, rows, emptyText = "Sin registros para este período" }) {
  return rows.length ? <div className="hf-table" tabIndex={0}><table>
    <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{rows.map(([id, cells]) => <tr key={id}>{cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
  </table></div> : <p className="hf-empty">{emptyText}</p>;
}

const findName = (rows, id) => rows.find((row) => row.id === id)?.name || "—";

function Breakdown({ data, dimension, title, label, catalog }) {
  const rows = financeBreakdown(data, dimension).map((row) => ({
    ...row, name: row.id ? findName(catalog, row.id) : "Sin asignar",
  })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return <section className="hf-section">
    <h2>{title}</h2>
    <Table headings={[label, "Ingreso agencia", "Gastos", "Total CRM"]}
      rows={rows.map(({ id, name, income, expenses, crm }) => [id ?? "unassigned", [name, usd(income), usd(expenses), usd(crm)]])} />
  </section>;
}

function Overview({ totals, data, onCreate }) {
  const { movements, sales, commissions } = data;
  const hasAmounts = (field) => sales.some((row) => row[field] != null) ||
    movements.some((row) => row.kind === "income" && row[field] != null);
  const hasOperations = hasOperatingAmounts(data);
  const investment = metricIf(movements, "investment", totals.investment);
  const cards = [
    ["Ingreso de la agencia", metricIf(movements, "income", totals.agency), Wallet, "income"],
    ["Gastos", metricIf(movements, "expense", totals.expense), ArrowUpRight, "expenses"],
    ["Utilidad operativa", hasOperations ? totals.profit : null, CircleDollarSign, "profit"],
    ["Total del reporte CRM", crmTotal(sales), BarChart3, "sales"],
  ];
  const detail = [
    ["Ventas brutas registradas", hasAmounts("gross") ? totals.gross : null],
    ["Ventas netas registradas", hasAmounts("net") ? totals.net : null],
    ["Comisiones calculadas", commissions.some((row) => row.commission != null) ? totals.commissions : null],
    ["Inversión", investment],
    ["Resultado después de inversión", hasOperations || investment !== null ? totals.afterInvestment : null],
  ];
  return <>
    <div className="hf-summary-head"><h2>Resumen del período</h2><button type="button" className="hf-primary" onClick={onCreate}><Plus size={16} /> Registrar movimiento</button></div>
    <div className="hf-kpis hf-overview-kpis">{cards.map(([label, value, Icon, tone]) => <article key={label} data-tone={tone}>
      <span className="hf-kpi-label"><Icon size={18} aria-hidden="true" />{label}</span>
      <strong>{usd(value)}</strong>
      {tone === "profit" && totals.withoutRate > 0 && <small>Provisional</small>}
    </article>)}</div>
    {totals.withoutRate > 0 && <p className="hf-notice">Hay {totals.withoutRate} registros de ventas atribuidas sin porcentaje vigente. La utilidad es provisional</p>}
    <Suspense fallback={<p className="hf-notice" role="status">Cargando gráficos…</p>}>
      <FinanceCharts data={data} />
    </Suspense>
    <section className="hf-section">
      <h2>Detalle financiero</h2>
      <dl className="hf-financial-detail">{detail.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{usd(value)}</dd></div>)}</dl>
      {totals.withoutPlatformAmounts > 0 && <p>Hay {totals.withoutPlatformAmounts} registros de AgencyKey sin desglose bruto y neto</p>}
    </section>
    <div className="hf-breakdowns">
      <Breakdown title="Por modelo" label="Modelo" data={data} dimension="model" catalog={data.creators} />
      <Breakdown title="Por plataforma" label="Plataforma" data={data} dimension="platform" catalog={data.platforms} />
    </div>
    <section className="hf-section"><h2>Ventas importadas de AgencyKey</h2>
      <Table headings={["Fecha", "Modelo", "Bruto", "Neto", "Total del reporte CRM"]} emptyText="Sin ventas importadas en este período"
        rows={[...sales].reverse().map((row) => [`${row.day}-${row.creator_id}`, [row.day, findName(data.creators, row.creator_id), usd(row.gross), usd(row.net), usd(row.crm_total)]])} />
    </section>
  </>;
}

function Movements({ data, onEdit }) {
  return <section className="hf-section">
    <div className="hf-summary-head"><h2>Movimientos manuales</h2><button type="button" className="hf-primary" onClick={() => onEdit()}><Plus size={16} /> Registrar movimiento</button></div>
    <Table headings={["Fecha", "Tipo", "Categoría", "Modelo", "Plataforma", "Importe", "Acción"]}
      rows={[...data.movements].reverse().map((row) => [row.id, [row.day, kinds[row.kind], <>{row.category}{row.description && <small>{row.description}</small>}</>,
        findName(data.creators, row.creator_id), findName(data.platforms, row.platform_id), usd(row.amount),
        <button type="button" aria-label={`Editar ${kinds[row.kind]} del ${row.day}`} onClick={() => onEdit(row)}>Editar</button>]])} />
  </section>;
}

function Commissions({ data, onEdit }) {
  return <>
    <section className="hf-section"><h2>Cálculo por período</h2>
      <p>Ventas atribuidas en AgencyKey × porcentaje vigente en la fecha de la venta</p>
      <Table headings={["Fecha", "Integrante", "Modelo", "Ventas atribuidas", "Porcentaje", "Comisión"]}
        rows={[...data.commissions].reverse().map((row) => [`${row.day}-${row.creator_id}-${row.member_id}`,
          [row.day, findName(data.members, row.member_id), findName(data.creators, row.creator_id), usd(row.attributed),
            row.percent == null ? "Sin vigencia" : `${row.percent} %`, usd(row.commission)]])} />
    </section>
    <section className="hf-section">
      <div className="hf-summary-head"><h2>Historial de porcentajes</h2><button type="button" className="hf-primary" disabled={!data.members.length} onClick={() => onEdit()}><Plus size={16} /> Nuevo porcentaje</button></div>
      <Table headings={["Integrante", "Vigente desde", "Porcentaje", "Acción"]} emptyText="Sin porcentajes registrados"
        rows={[...data.rates].reverse().map((row) => [`${row.member_id}-${row.effective_on}`, [findName(data.members, row.member_id), row.effective_on, `${row.percent} %`,
          <button type="button" onClick={() => onEdit(row)}>Editar</button>]])} />
    </section>
  </>;
}

function Employees({ data, onCreate, onDistributionSaved }) {
  return <>
    <div className="hf-summary-head">
      <h2>Empleados</h2>
      <div className="hf-actions">
        <button type="button" onClick={() => onCreate("member")}><Plus size={16} /> Agregar chatter</button>
        <button type="button" onClick={() => onCreate("creator")}><Plus size={16} /> Agregar modelo</button>
      </div>
    </div>
    <Distribution data={data} onSaved={onDistributionSaved} />
    <section className="hf-section">
      <div className="hf-summary-head"><h2>Plataformas</h2><button type="button" onClick={() => onCreate("platform")}><Plus size={16} /> Agregar plataforma</button></div>
      <Table headings={["Nombre"]} emptyText="Sin plataformas registradas" rows={data.platforms.map(({ id, name }) => [id, [name]])} />
    </section>
  </>;
}

function Editor({ editor: { type, row }, data, onClose, onSaved }) {
  const [values, setValues] = useState(row ?? { day: dateKey(new Date()), effective_on: dateKey(new Date()), kind: "expense" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const field = (label, key, props) => <label>{label}<input {...props} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} /></label>;
  const select = (label, key, rows, required) =>
    <Choice label={label} value={values[key]} rows={rows} onChange={(value) => set(key, value)} required={required} />;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let request;
      if (type === "movement") {
        const { day, kind, category, description, creator_id, platform_id, amount, gross, net } = values;
        const payload = { day, kind, category: category.trim(), description: description?.trim() || "",
          creator_id: creator_id || null, platform_id: platform_id || null, amount,
          gross: kind === "income" ? gross : null, net: kind === "income" ? net : null };
        const table = supabase.from("finance_movements");
        request = row ? table.update(payload).eq("id", row.id) : table.insert(payload);
      } else if (type === "rate") {
        const { member_id, effective_on, percent } = values;
        const table = supabase.from("finance_rates");
        request = row ? table.update({ percent }).eq("member_id", row.member_id).eq("effective_on", row.effective_on)
          : table.insert({ member_id, effective_on, percent });
      } else {
        request = supabase.from(catalogTables[type]).insert({ name: values.name.trim() });
      }
      const { error: failure } = await request.select().single();
      if (failure) throw failure;
      onSaved();
    } catch (failure) {
      setError(failure.code === "23505" ? "Ya existe un registro con esos datos" : "No se pudo guardar. Revisa los campos y los permisos");
    } finally { setSaving(false); }
  };

  return <dialog className="hf-dialog" aria-labelledby="hf-editor-title" ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="hf-editor-title">{row ? "Editar" : "Registrar"} {type === "movement" ? "movimiento" : type === "rate" ? "porcentaje" : catalog[type].toLowerCase()}</h2>
      <div className="hf-form">
        {type === "movement" && <>
          {field("Fecha", "day", { type: "date", required: true })}
          <label>Tipo<select value={values.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {field("Categoría", "category", { list: "hf-categories", maxLength: 120, required: true })}
          <datalist id="hf-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
          {field("Descripción", "description", { maxLength: 500 })}
          {select("Modelo", "creator_id", data.creators)}
          {select("Plataforma", "platform_id", data.platforms, values.kind === "income")}
          {field(values.kind === "income" ? "Ingreso de la agencia (USD)" : "Importe (USD)", "amount",
            { type: "number", step: "0.01", min: values.kind === "income" ? undefined : "0.01", required: true })}
          {values.kind === "income" && <>
            {field("Ventas brutas (USD)", "gross", { type: "number", step: "0.01", required: true })}
            {field("Ventas netas (USD)", "net", { type: "number", step: "0.01", required: true })}
          </>}
        </>}
        {type === "rate" && <>
          {row ? <p>{findName(data.members, row.member_id)}</p> : select("Integrante", "member_id", data.members, true)}
          {field("Vigente desde", "effective_on", { type: "date", required: true, disabled: Boolean(row) })}
          {field("Porcentaje", "percent", { type: "number", min: 0, max: 100, step: "0.0001", required: true })}
        </>}
        {catalog[type] && field("Nombre", "name", { maxLength: 120, required: true })}
      </div>
      {error && <p className="hf-notice" role="alert">{error}</p>}
      <div className="hf-actions"><button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" className="hf-primary" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button></div>
    </form>
  </dialog>;
}
