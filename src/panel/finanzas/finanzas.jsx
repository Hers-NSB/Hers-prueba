import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUpRight, BarChart3, CircleDollarSign, Plus, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { dateKey, financeBreakdown, hasOperatingAmounts, kinds, metricIf, monthRange, netSales, summarize, usd } from "./finance";
import callApi from "../integrations/connectorApi";
import PeriodPicker from "./PeriodPicker";
import { calculateDistribution } from "./distribution";
import Distribution from "./Distribution";
import "./finanzas.css";

const FinanceCharts = lazy(() => import("./FinanceCharts"));

const empty = { movements: [], sales: [], commissions: [], creators: [], platforms: [], members: [], categories: [], distributionPlans: [] };
const catalog = { platform: "Plataforma", creator: "Modelo" };
const catalogTables = { platform: "finance_platforms", creator: "finance_creators" };
const tabs = ["Resumen", "Extracción", "Empleados"];
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

async function loadFinance({ from, to }) {
  const { data: allowed, error } = await supabase.rpc("finance_is_admin");
  if (error?.code === "42501" || !error && !allowed) return null;
  if (error) throw error;
  const inPeriod = (query) => query.gte("day", from).lte("day", to);
  const [movements, sales, creators, platforms, members, categories, distributionPlans] = await Promise.all([
    readRows("finance_movements", ["day", "id"], inPeriod),
    readRows("finance_agencykey_sales", ["day", "creator_id"], inPeriod),
    readRows("finance_creators", ["name", "id"]),
    readRows("finance_platforms", ["name", "id"]),
    readRows("finance_members", ["name", "id"]),
    readRows("finance_categories", ["name"]),
    readRows("finance_distribution_plans", ["effective_on", "revision"]),
  ]);
  return { ...empty, movements, sales, creators, platforms, members, categories, distributionPlans };
}

export default function Finanzas() {
  const [filters, setFilters] = useState(monthRange);
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState(tabs[0]);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState(null);

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

  const updateFilters = (period) => {
    if (period.from === filters.from && period.to === filters.to) return;
    setState("loading");
    setNotice(null);
    setFilters(period);
  };
  const reload = () => { setState("loading"); refresh((value) => value + 1); };
  const invalid = !filters.from || !filters.to || filters.from > filters.to;
  const totals = summarize(data);
  const distribution = calculateDistribution(data.sales, data.distributionPlans, data.members);
  const notifications = [
    notice,
    state === "ready" && totals.withoutNet > 0 && { text: "Hay ventas del período con el neto pendiente" },
  ].filter(Boolean);

  async function update() {
    if (updating || invalid) return;
    setUpdating(true);
    setNotice(null);
    let synced = 0;
    try {
      for (let timestamp = Date.parse(filters.from); timestamp <= Date.parse(filters.to); timestamp += 86_400_000) {
        const day = new Date(timestamp).toISOString().slice(0, 10);
        const result = await callApi("/sync", "POST", { day });
        if (result.future) break;
        synced += 1;
      }
      setNotice({ text: synced ? "Finanzas actualizado" : "El período aún no tiene fechas disponibles" });
    } catch (error) {
      setNotice({ error: true, text: synced ? `${synced} días actualizados. ${error.message}` : error.message });
    } finally {
      reload();
      setUpdating(false);
    }
  }

  return <section className="hf hf-finance" aria-label="Finanzas">
    <header className="hf-header">
      <div><h1>Finanzas</h1><p>Ventas de plataforma y resultados de la agencia</p></div>
      <button type="button" className="hf-select-trigger" onClick={update} disabled={updating || invalid || state !== "ready"}>
        <RefreshCw size={16} aria-hidden="true" /> {updating ? "Actualizando…" : "Actualizar"}
      </button>
    </header>
    {state === "denied" ? <p role="alert" className="hf-notice">Tu cuenta no tiene acceso a Finanzas</p> : <>
      <nav className="hf-tabs" aria-label="Secciones de Finanzas">
        {tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      <div className="hf-toolbar">
        <PeriodPicker value={filters} onChange={updateFilters} disabled={updating} />
        {notifications.length > 0 && <aside className="hf-notifications" aria-label="Notificaciones">
          <strong>Notificaciones</strong>
          {notifications.map(({ error, text }) => <p key={text} role={error ? "alert" : "status"}>{text}</p>)}
        </aside>}
      </div>
      {invalid && <p className="hf-notice" role="alert">Selecciona un período válido</p>}
      {!invalid && state === "loading" && <p className="hf-notice" role="status">Cargando Finanzas…</p>}
      {!invalid && state === "error" && <p className="hf-notice" role="alert">No se pudieron cargar los datos de Finanzas <button type="button" onClick={reload}>Reintentar</button></p>}
      {!invalid && state === "ready" && <>
        {tab === "Resumen" && <Overview totals={totals} data={data} distribution={distribution} />}
        {tab === "Extracción" && <Movements data={data} onEdit={(row) => setEditor({ type: "movement", row })} />}
        {tab === "Empleados" && <Employees data={data} onEdit={(type, row) => setEditor({ type, row })} distribution={distribution}
          onDistributionSaved={(plan) => setData((current) => ({
            ...current,
            distributionPlans: [...current.distributionPlans, plan].sort((a, b) =>
              a.effective_on.localeCompare(b.effective_on) || a.revision - b.revision),
          }))} />}
      </>}
      {editor && <Editor editor={editor} data={data} onClose={() => setEditor(null)} onCategorySaved={(name) => setData((current) => ({ ...current, categories: [...current.categories, { name }] }))} onSaved={() => { setEditor(null); reload(); }} />}
    </>}
  </section>;
}

function Choice({ label, value, rows, onChange, placeholder = "Sin asignar", required = false }) {
  return <label>{label}<select className="hf-select-trigger" required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
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
    <Table headings={[label, "Ingreso agencia", "Gastos", "Ventas netas"]}
      rows={rows.map(({ id, name, income, expenses, net }) => [id ?? "unassigned", [name, usd(income), usd(expenses), usd(net)]])} />
  </section>;
}

function Overview({ totals, data, distribution }) {
  const { movements, sales } = data;
  const vault = distribution.payouts.get("hers");
  const manualIncome = metricIf(movements, "income", totals.agency);
  const agencyIncome = manualIncome == null && vault == null ? null : (manualIncome ?? 0) + (vault ?? 0);
  const hasOperations = hasOperatingAmounts(data) || vault != null;
  const investment = metricIf(movements, "investment", totals.investment);
  const cards = [
    ["Ingreso de la agencia", agencyIncome, Wallet, "income"],
    ["Gastos", metricIf(movements, "expense", totals.expense), ArrowUpRight, "expenses"],
    ["Utilidad operativa", hasOperations ? totals.profit + (vault ?? 0) : null, CircleDollarSign, "profit"],
    ["Ventas netas", netSales(sales, movements), BarChart3, "sales"],
  ];
  const detail = [
    ["Bóveda de Agencia HERS", vault],
    ["Inversión", investment],
    ["Resultado después de inversión", hasOperations || investment !== null ? totals.afterInvestment + (vault ?? 0) : null],
  ];
  return <>
    <h2>Resumen del período</h2>
    <div className="hf-kpis hf-overview-kpis">{cards.map(([label, value, Icon, tone]) => <article key={label} data-tone={tone}>
      <span className="hf-kpi-label"><Icon size={18} aria-hidden="true" />{label}</span>
      <strong>{usd(value)}</strong>
    </article>)}</div>
    <Suspense fallback={<p className="hf-notice" role="status">Cargando gráficos…</p>}>
      <FinanceCharts data={data} agencyByDay={distribution.agencyByDay} />
    </Suspense>
    <section className="hf-section">
      <h2>Detalle financiero</h2>
      <dl className="hf-financial-detail">{detail.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{usd(value)}</dd></div>)}</dl>
    </section>
    <div className="hf-breakdowns">
      <Breakdown title="Por modelo" label="Modelo" data={data} dimension="model" catalog={data.creators} />
      <Breakdown title="Por plataforma" label="Plataforma" data={data} dimension="platform" catalog={data.platforms} />
    </div>
  </>;
}

function Movements({ data, onEdit }) {
  return <section className="hf-section">
    <div className="hf-summary-head"><h2>Extracción</h2><button type="button" className="hf-primary" onClick={() => onEdit()}><Plus size={16} /> Registrar movimiento</button></div>
    <Table headings={["Fecha", "Tipo", "Categoría", "Modelo", "Plataforma", "Importe", "Acción"]}
      rows={[...data.movements].reverse().map((row) => [row.id, [row.day, kinds[row.kind], <>{row.category}{row.description && <small>{row.description}</small>}</>,
        findName(data.creators, row.creator_id), findName(data.platforms, row.platform_id), usd(row.amount),
        <button type="button" aria-label={`Editar ${kinds[row.kind]} del ${row.day}`} onClick={() => onEdit(row)}>Editar</button>]])} />
  </section>;
}

function Employees({ data, onEdit, distribution, onDistributionSaved }) {
  return <>
    <div className="hf-summary-head">
      <h2>Empleados</h2>
      <div className="hf-actions">
        <button type="button" onClick={() => onEdit("agencykey")}><Plus size={16} /> Agregar desde AgencyKey</button>
        <button type="button" onClick={() => onEdit("member")}><Plus size={16} /> Agregar manualmente</button>
      </div>
    </div>
    <Table headings={["Nombre", "Rol", "Origen", "Acciones"]} emptyText="Sin empleados registrados"
      rows={data.members.filter((row) => !row.archived_on).map((row) => [row.id, [
        row.name, row.role, row.agencykey_id ? "AgencyKey" : "Manual",
        <div className="hf-actions"><button type="button" onClick={() => onEdit("member", row)}>Editar</button>
          <button type="button" onClick={() => onEdit("archive", row)}>Eliminar</button></div>,
      ]])} />
    <Distribution data={data} result={distribution} onSaved={onDistributionSaved} />
    <section className="hf-section">
      <div className="hf-summary-head"><h2>Catálogos</h2><div className="hf-actions">
        <button type="button" onClick={() => onEdit("creator")}><Plus size={16} /> Agregar modelo</button>
        <button type="button" onClick={() => onEdit("platform")}><Plus size={16} /> Agregar plataforma</button>
      </div></div>
      <Table headings={["Plataforma"]} emptyText="Sin plataformas registradas" rows={data.platforms.map(({ id, name }) => [id, [name]])} />
    </section>
  </>;
}

function Editor({ editor: { type, row }, data, onClose, onCategorySaved, onSaved }) {
  const [values, setValues] = useState(row ?? { day: dateKey(new Date()), effective_on: dateKey(new Date()), kind: "expense" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [categories, setCategories] = useState(data.categories.map(({ name }) => name));
  const [newCategory, setNewCategory] = useState(null);
  useEffect(() => {
    if (type !== "agencykey") return;
    const controller = new AbortController();
    callApi("/employees", "GET", undefined, controller.signal).then(({ employees }) => setCandidates(employees))
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [type]);
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
        const { day, kind, category, description, creator_id, platform_id, amount, net } = values;
        const payload = { day, kind, category: category.trim(), description: description?.trim() || "",
          creator_id: creator_id || null, platform_id: platform_id || null, amount,
          gross: kind === "income" && row ? row.gross : null, net: kind === "income" ? net : null };
        const table = supabase.from("finance_movements");
        request = row ? table.update(payload).eq("id", row.id) : table.insert(payload);
      } else if (type === "member" || type === "agencykey" || type === "archive") {
        const table = supabase.from("finance_members");
        if (type === "archive") request = table.update({ archived_on: dateKey(new Date()) }).eq("id", row.id);
        else {
          const payload = { name: values.name.trim(), role: values.role.trim(), archived_on: null };
          request = type === "agencykey"
            ? table.upsert({ ...payload, agencykey_id: values.agencykey_id }, { onConflict: "agencykey_id" })
            : row ? table.update(payload).eq("id", row.id) : table.insert(payload);
        }
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

  async function addCategory() {
    const name = newCategory.trim();
    if (!name || name.length > 120) return;
    setSaving(true);
    setError("");
    try {
      const { error } = await supabase.from("finance_categories").insert({ name });
      if (error) throw error;
      setCategories((current) => [...current, name]);
      onCategorySaved(name);
      set("category", name);
      setNewCategory(null);
    } catch (error) {
      setError(error.code === "23505" ? "Ya existe una categoría con ese nombre" : "No se pudo crear la categoría");
    } finally { setSaving(false); }
  }

  const title = { movement: row ? "Editar movimiento" : "Registrar movimiento", member: row ? "Editar empleado" : "Agregar empleado",
    agencykey: "Agregar desde AgencyKey", archive: "Eliminar empleado" };

  return <dialog className="hf-dialog" aria-labelledby="hf-editor-title" ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="hf-editor-title">{title[type] ?? `Agregar ${catalog[type]?.toLowerCase()}`}</h2>
      <div className="hf-form">
        {type === "movement" && <>
          {field("Fecha", "day", { type: "date", required: true })}
          <label>Tipo<select className="hf-select-trigger" value={values.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <div className="hf-category">
            {select("Categoría", "category", [...new Set([...categories, ...(values.category ? [values.category] : [])])]
              .map((name) => ({ id: name, name })), true)}
            {newCategory === null
              ? <button type="button" onClick={() => setNewCategory("")}><Plus size={15} /> Crear categoría</button>
              : <><label>Nueva categoría<input maxLength={120} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} /></label>
                <button type="button" disabled={saving || !newCategory.trim()} onClick={addCategory}>Guardar categoría</button>
                <button type="button" onClick={() => setNewCategory(null)}>Cancelar categoría</button></>}
          </div>
          {field("Descripción", "description", { maxLength: 500 })}
          {select("Modelo", "creator_id", data.creators)}
          {select("Plataforma", "platform_id", data.platforms, values.kind === "income")}
          {field(values.kind === "income" ? "Ingreso de la agencia (USD)" : "Importe (USD)", "amount",
            { type: "number", step: "0.01", min: values.kind === "income" ? undefined : "0.01", required: true })}
          {values.kind === "income" && <>
            {field("Ventas netas (USD)", "net", { type: "number", step: "0.01", required: true })}
          </>}
        </>}
        {type === "archive" && <p>Retirar a {row.name} del listado de empleados y conservar su historial</p>}
        {type === "agencykey" && (!candidates ? <p role="status">{error ? "Directorio no disponible" : "Cargando empleados…"}</p>
          : <Choice label="Empleado" value={values.agencykey_id} required placeholder="Selecciona un empleado"
            rows={candidates.filter((candidate) => !data.members.some((member) => !member.archived_on && member.agencykey_id === candidate.id))}
            onChange={(id) => {
              const candidate = candidates.find((entry) => entry.id === id);
              setValues({ agencykey_id: id, name: candidate?.name ?? "", role: "Chatter" });
            }} />)}
        {(type === "member" || (type === "agencykey" && values.agencykey_id)) && <>
          {field("Nombre", "name", { maxLength: 120, required: true })}
          {field("Rol", "role", { maxLength: 120, required: true })}
        </>}
        {catalog[type] && field("Nombre", "name", { maxLength: 120, required: true })}
      </div>
      {error && <p className="hf-notice" role="alert">{error}</p>}
      <div className="hf-actions"><button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" className="hf-primary" disabled={saving || (type === "agencykey" && !values.agencykey_id)}>{saving ? "Guardando…" : type === "archive" ? "Eliminar" : "Guardar"}</button></div>
    </form>
  </dialog>;
}
