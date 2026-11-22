import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUpRight, BarChart3, ChevronDown, CircleDollarSign, FileCheck, Plus, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { dateKey, financeBreakdown, hasOperatingAmounts, investmentTotal, kinds, missingAgencyKeyDays, monthRange, netSales, summarize, usd } from "./finance";
import callApi from "../integrations/connectorApi";
import PeriodPicker from "./PeriodPicker";
import { calculateModelDistribution, effectiveShare, isChatter } from "./distribution";
import CategoryPicker from "./CategoryPicker";
import PaymentHistory from "./PaymentHistory";
import "./finanzas.css";

const FinanceCharts = lazy(() => import("./FinanceCharts"));

const empty = { movements: [], sales: [], commissions: [], creators: [], platforms: [], members: [], categories: [], distributionPlans: [], rates: [], availability: [], employeeNet: [], allMovements: [], allSales: [], currentPay: {}, payPeriod: null };
const catalog = { platform: "Plataforma" };
const tabs = ["Resumen", "Movimiento", "Empleados"];
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
  const [allMovements, allSales, creators, platforms, members, categories, distributionPlans, rates, availability, employeeNet, payroll] = await Promise.all([
    readRows("finance_movements", ["day", "id"]),
    readRows("finance_agencykey_sales", ["day", "creator_id"]),
    readRows("finance_creators", ["name", "id"]),
    readRows("finance_platforms", ["name", "id"]),
    readRows("finance_members", ["name", "id"]),
    readRows("finance_categories", ["name"]),
    readRows("finance_distribution_plans", ["effective_on", "revision"]),
    readRows("finance_model_shares", ["effective_on", "id"]),
    readRows("finance_member_availability", ["effective_on", "member_id"]),
    readRows("finance_agencykey_employee_net", ["day"], inPeriod),
    supabase.rpc("finance_current_pay"),
  ]);
  if (payroll.error) throw payroll.error;
  const { amounts: currentPay, ...payPeriod } = payroll.data;
  return { ...empty, currentPay, payPeriod, movements: allMovements.filter(({ day }) => day >= from && day <= to),
    allMovements, allSales, sales: allSales.filter(({ day }) => day >= from && day <= to), creators, platforms, members, categories, distributionPlans, rates, availability, employeeNet };
}

export default function Finanzas() {
  const [filters, setFilters] = useState(monthRange);
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState(tabs[0]);
  const [revision, refresh] = useState(0);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [directoryError, setDirectoryError] = useState(null);
  const [directoryRevision, refreshDirectory] = useState(0);
  const [movementFilters, setMovementFilters] = useState({});

  useEffect(() => {
    if (!filters.from || !filters.to || filters.from > filters.to) return;
    let active = true;
    loadFinance(filters).then((result) => {
      if (!active) return;
      setData(result ?? empty);
      setAccess(Boolean(result));
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      console.error("Finanzas", error.code || error.message);
      setLoadError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [filters, revision]);

  useEffect(() => {
    if (tab !== "Empleados") return;
    const controller = new AbortController();
    callApi("/employees", "POST", undefined, controller.signal).then(() => {
      if (!controller.signal.aborted) {
        setDirectoryError(null);
        reload();
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setDirectoryError(error);
    });
    return () => controller.abort();
  }, [tab, directoryRevision]);

  useEffect(() => {
    if (tab !== "Empleados" || !access) return;
    const checkPeriod = () => {
      if (document.visibilityState === "visible") refresh((value) => value + 1);
    };
    const timer = window.setInterval(checkPeriod, 60_000);
    document.addEventListener("visibilitychange", checkPeriod);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkPeriod);
    };
  }, [access, tab]);

  async function updateFilters(period) {
    if (period.from === filters.from && period.to === filters.to) return;
    setLoading(true);
    setLoadError(false);
    setSyncError("");
    setFilters(period);
    await syncDays(missingAgencyKeyDays(period, data.allSales, data.creators));
  }
  function reload() {
    setLoading(true);
    setLoadError(false);
    refresh((value) => value + 1);
  }
  const invalid = !filters.from || !filters.to || filters.from > filters.to;
  const totals = summarize(data);
  const distribution = calculateModelDistribution(data.sales, data.distributionPlans, data.members, data.rates, data.availability, data.employeeNet);

  async function syncDays(days) {
    if (!days.length) return;
    setUpdating(true);
    setSyncError("");
    let synced = 0;
    const errors = [];
    try {
      for (const day of days) {
        try {
          const result = await callApi("/sync", "POST", { day });
          if (result.future) break;
          synced += 1;
        } catch (error) {
          errors.push(error.message);
          if (/\[(?:CON-|AK-KEY-MISSING)/.test(error.message)) break;
        }
      }
      if (errors.length) setSyncError([
        synced > 0 && `Días actualizados: ${synced}.`,
        errors.length > 1 && `Días con error: ${errors.length}.`,
        errors[0],
      ].filter(Boolean).join(" "));
    } finally {
      reload();
      setUpdating(false);
    }
  }

  async function update() {
    if (updating || (tab === "Resumen" && invalid)) return;
    const range = tab === "Empleados" ? data.payPeriod : filters;
    const days = missingAgencyKeyDays(range, [], []);
    await syncDays(days);
    if (tab === "Empleados") refreshDirectory((value) => value + 1);
  }

  const busy = loading || updating;
  return <section className="hf hf-finance" aria-label="Finanzas">
    <header className="hf-header">
      <div><h1>Finanzas {busy && <RefreshCw className="hf-refreshing" size={20} role="status" aria-label="Actualizando Finanzas" />}</h1><p>Ventas de plataforma y resultados de la agencia</p></div>
      <button type="button" className="hf-select-trigger" onClick={update} disabled={busy || (tab === "Resumen" && invalid) || !access}>
        <RefreshCw size={16} aria-hidden="true" /> {updating ? "Actualizando…" : "Actualizar"}
      </button>
    </header>
    {access === false ? <p role="alert" className="hf-notice">Tu cuenta no tiene acceso a Finanzas</p> : <>
      <nav className="hf-tabs" aria-label="Secciones de Finanzas">
        {tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      {tab === "Resumen" && <div className="hf-toolbar">
        <PeriodPicker value={filters} onChange={updateFilters} disabled={busy || !access} />
      </div>}
      {syncError && <p className="hf-notice" role="alert">{syncError}</p>}
      {tab === "Resumen" && invalid && <p className="hf-notice" role="alert">Selecciona un período válido</p>}
      {loadError && <p className="hf-notice" role="alert">No se pudieron actualizar los datos de Finanzas <button type="button" onClick={reload}>Reintentar</button></p>}
      {access && <div aria-busy={busy}>
        {tab === "Resumen" && <Overview totals={totals} data={data} distribution={distribution} />}
        {tab === "Movimiento" && <Movements data={data} filters={movementFilters} onFilter={setMovementFilters}
          onEdit={(row) => setEditor({ type: "movement", row })} />}
        {tab === "Empleados" && <Employees data={data} directoryError={directoryError}
          onEdit={(type, row) => setEditor({ type, row })} />}
      </div>}
      {editor && <Editor editor={editor} data={data} onChange={reload} onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); reload(); }} />}

    </>}
  </section>;
}

function Choice({ label, value, rows, onChange, placeholder = "Sin asignar", required = false }) {
  return <label>{label}<span className="hf-choice">
    <select className="hf-select-trigger" required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {rows.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select><ChevronDown size={17} aria-hidden="true" />
  </span></label>;
}

function DateField({ label, value, onChange, required }) {
  return <label>{label}<input className="hf-select-trigger" type="date" value={value ?? ""}
    required={required} onChange={(event) => onChange(event.target.value)} /></label>;
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
    ...row,
    name: row.id ? findName(catalog, row.id) : "Sin asignar",
    profit: row.expenses == null && row.net == null ? null
      : (Math.round((row.expenses ?? 0) * 100) - Math.round((row.net ?? 0) * 100)) / 100,
  })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return <section className="hf-section">
    <h2>{title}</h2>
    <Table headings={[label, "Ganancia", "Inversión", "Ventas netas"]}
      rows={rows.map(({ id, name, profit, expenses, net }) => [id ?? "unassigned", [name, usd(profit), usd(expenses), usd(net)]])} />
  </section>;
}

function Overview({ totals, data, distribution }) {
  const { movements, sales } = data;
  const vault = distribution.payouts.get("hers");
  const pending = Boolean(distribution.pendingDays?.size);
  const hasOperations = hasOperatingAmounts(data) || vault != null;
  const investment = investmentTotal(movements, totals);
  const history = { movements: data.allMovements, sales: data.allSales, commissions: [] };
  const historicalNet = netSales(history.sales, history.movements);
  const historicalInvestment = investmentTotal(history.movements, summarize(history));
  const balance = historicalNet == null && historicalInvestment == null ? null
    : (Math.round((historicalNet ?? 0) * 100) - Math.round((historicalInvestment ?? 0) * 100)) / 100;
  const cards = [
    ["Bóveda de HERS", balance, Wallet, "income"],
    ["Inversión", investment, ArrowUpRight, "expenses"],
    ["Ganancia", !pending && hasOperations ? totals.afterInvestment + (vault ?? 0) : null, CircleDollarSign, "profit"],
    ["Ventas netas", netSales(sales, movements), BarChart3, "sales"],
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
      <FinanceCharts data={data} agencyByDay={distribution.agencyByDay} pendingDays={distribution.pendingDays} />
    </Suspense>
    <div className="hf-breakdowns">
      <Breakdown title="Por modelo" label="Modelo" data={data} dimension="model" catalog={data.creators} />
      <Breakdown title="Por plataforma" label="Plataforma" data={data} dimension="platform" catalog={data.platforms} />
    </div>
  </>;
}

function Movements({ data, filters, onFilter, onEdit }) {
  const change = (key, value) => onFilter((current) => ({ ...current, [key]: value }));
  const select = (label, key, rows, placeholder = "Todos") => <Choice label={label} value={filters[key]}
    rows={rows} placeholder={placeholder} onChange={(value) => change(key, value)} />;
  const categories = [...new Set([...data.categories.map(({ name }) => name), ...data.allMovements.map(({ category }) => category)])].sort();
  const rows = data.allMovements.filter((row) =>
    (!filters.period || (row.day >= filters.period.from && row.day <= filters.period.to)) &&
    (!filters.kind || (row.kind === "expense" ? "investment" : row.kind) === filters.kind) &&
    (!filters.category || row.category === filters.category) &&
    (!filters.creator || (row.creator_id ?? "none") === filters.creator) &&
    (!filters.platform || (row.platform_id ?? "none") === filters.platform) &&
    (!filters.updated || Boolean(row.updated_at) === (filters.updated === "yes")));
  return <section className="hf-section">
    <div className="hf-summary-head"><h2>Movimiento</h2><button type="button" className="hf-primary" onClick={() => onEdit()}><Plus size={16} /> Registrar movimiento</button></div>
    <div className="hf-movement-filters" role="group" aria-label="Filtros de movimientos">
      <PeriodPicker value={filters.period} label="Fechas" onChange={(period) => change("period", period)} />
      {select("Tipo", "kind", [{ id: "investment", name: kinds.investment }, { id: "income", name: kinds.income }])}
      {select("Categoría", "category", categories.map((name) => ({ id: name, name })), "Todas")}
      {select("Modelo", "creator", [...data.creators, { id: "none", name: "Sin asignar" }])}
      {select("Plataforma", "platform", [...data.platforms, { id: "none", name: "Sin asignar" }], "Todas")}
      {select("Actualizado", "updated", [{ id: "yes", name: "Sí" }, { id: "no", name: "No" }])}
      <button type="button" onClick={() => onFilter({})}>Limpiar filtros</button>
    </div>
    <Table headings={["Fecha", "Tipo", "Categoría", "Modelo", "Plataforma", "Importe", "Acción"]}
      emptyText="Sin movimientos para estos filtros"
      rows={[...rows].reverse().map((row) => [row.id, [row.day, kinds[row.kind],
        row.description ? <span className="hf-category-label" tabIndex={0} aria-describedby={`description-${row.id}`}>
          {row.category}<small role="tooltip" id={`description-${row.id}`}>{row.description}</small>
        </span> : row.category,
        findName(data.creators, row.creator_id), findName(data.platforms, row.platform_id), usd(row.amount),
        <div className="hf-actions">{row.finance_payment_id ? <span>Pago confirmado</span>
          : <button type="button" aria-label={`Editar ${kinds[row.kind]} del ${row.day}`} onClick={() => onEdit(row)}>Editar</button>}
          {row.updated_at && <span className="hf-updated" title={`Actualizado el ${new Date(row.updated_at).toLocaleString("es-VE")}`}>
            <FileCheck size={17} aria-label="Movimiento actualizado" />
          </span>}
        </div>]])} />
  </section>;
}

const isCurrent = (entry) => entry.agencykey_available !== false;
const percentage = new Intl.NumberFormat("es-VE", { style: "percent", maximumFractionDigits: 2 });
const percentLabel = (value) => percentage.format(Number(value) / 100);

function Employees({ data, directoryError, onEdit }) {
  const currentDay = data.payPeriod?.day ?? dateKey(new Date());
  const members = data.members.filter((row) => !row.archived_on && isCurrent(row));
  const creators = data.creators.filter(isCurrent);
  const participants = [
    ...data.members.map((row) => [row, "member", `chatter:${row.id}`, !row.archived_on && isCurrent(row)]),
    ...data.creators.map((row) => [{ ...row, role: "Modelo" }, "modelShare", `model:${row.id}`, isCurrent(row)]),
  ].sort(([a], [b]) => a.name.localeCompare(b.name, "es"));
  const headings = ["Nombre", "Rol", "Origen", "Porcentaje", "Pago ($)", "Acciones"];
  const rows = (active) => participants.filter((entry) => entry[3] === active).map(([row, type, recipient]) => {
    const rate = effectiveShare(data.rates, recipient, currentDay);
    const eligible = type === "modelShare" || isChatter(row.role);
    const payout = data.currentPay[recipient] ?? (data.payPeriod?.day === data.payPeriod?.from && row.agencykey_id ? 0 : null);
    const amount = !eligible || !rate ? "—" : payout == null && !row.agencykey_id && type === "member"
      ? "Pendiente de vincular" : payout == null ? "Pendiente de sincronizar" : usd(payout);
    return [recipient, [row.name, row.role, row.agencykey_id ? "AgencyKey" : "Manual",
      rate ? percentLabel(rate.percent) : "—", active ? amount : "—",
      <div className="hf-actions"><button type="button" onClick={() => onEdit(type, row)}>Editar</button>
        {active && type === "member" && !row.agencykey_id && <button type="button" onClick={() => onEdit("archive", row)}>Eliminar</button>}</div>]];
  });
  const inactive = rows(false);
  return <>
    <div className="hf-summary-head">
      <h2>Empleados</h2>
      <div className="hf-actions">
        <button type="button" onClick={() => onEdit("member")}><Plus size={16} /> Agregar empleado</button>
      </div>
    </div>
    <p className="hf-employee-count">{creators.length} modelos · {members.filter(({ role }) => isChatter(role)).length} chatters
      {data.payPeriod && ` · Corte actual: ${data.payPeriod.from} a ${data.payPeriod.to}`}</p>
    {directoryError && <p className="hf-notice" role="alert">{directoryError.message.startsWith("[AK-DIRECTORY-CONNECT]")
      ? "Autoriza el directorio de AgencyKey en Conectores para sincronizar el listado."
      : directoryError.message}</p>}
    <Table headings={headings} rows={rows(true)} emptyText="Sin empleados registrados" />
    {inactive.length > 0 && <details className="hf-section"><summary>Personas inactivas</summary>
      <Table headings={headings} rows={inactive} />
    </details>}
    <section className="hf-section">
      <div className="hf-summary-head"><h2>Catálogos</h2><div className="hf-actions">
        <button type="button" onClick={() => onEdit("platform")}><Plus size={16} /> Agregar plataforma</button>
      </div></div>
      <Table headings={["Plataforma"]} emptyText="Sin plataformas registradas" rows={data.platforms.map(({ id, name }) => [id, [name]])} />
    </section>
  </>;
}

function Editor({ editor: { type, row }, data, onClose, onSaved, onChange }) {
  const today = dateKey(new Date());
  const rateDay = data.payPeriod?.day ?? today;
  const recipient = type === "modelShare" ? `model:${row.id}` : row && `chatter:${row.id}`;
  const share = effectiveShare(data.rates, recipient, rateDay);
  const initialValues = { day: today, effective_on: rateDay, kind: "investment", percent: 0, creator_ids: [],
    ...row, ...(share && { percent: share.percent, creator_ids: share.creator_ids }) };
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const availableModels = data.creators.filter((creator) => isCurrent(creator) || values.creator_ids.includes(creator.id));
  const memberShare = type === "member";
  const byEmployee = memberShare && isChatter(values.role);
  const field = (label, key, props) => <label>{label}<input {...props} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} /></label>;
  const select = (label, key, rows) =>
    <Choice label={label} value={values[key]} rows={rows} onChange={(value) => set(key, value)} />;

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let request;
      if (type === "movement") {
        const { day, kind, category, description, creator_id, platform_id, amount } = values;
        if (!category) throw new Error("Selecciona una categoría");
        const payload = { day, kind, category, description: description?.trim() || "",
          creator_id: creator_id || null, platform_id: platform_id || null, amount,
          gross: kind === "income" ? row?.gross ?? null : null, net: kind === "income" ? row?.net ?? null : null };
        const table = supabase.from("finance_movements");
        request = row ? table.update(payload).eq("id", row.id).select("id").single() : table.insert(payload);
      } else if (type === "archive") {
        request = supabase.from("finance_members").update({ archived_on: today }).eq("id", row.id).select("id").single();
      } else if (memberShare) {
        if (!byEmployee && Number(values.percent) > 0 && !values.creator_ids.length) throw new Error("Selecciona al menos un modelo");
        request = supabase.rpc("finance_save_member_share", {
          p_member_id: row?.id ?? null, p_agencykey_id: null,
          p_name: values.name, p_role: values.role,
          p_effective_on: values.effective_on, p_percent: Number(values.percent), p_creator_ids: byEmployee ? [] : values.creator_ids,
        });
      } else if (type === "modelShare") {
        request = supabase.from("finance_model_shares").upsert({
          creator_id: row.id, member_id: null, effective_on: values.effective_on, percent: Number(values.percent),
        }, { onConflict: "member_id,creator_id,effective_on" });
      } else {
        request = supabase.from("finance_platforms").insert({ name: values.name.trim() });
      }
      const { error: failure } = await request;
      if (failure) throw failure;
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failure.code === "23505"
        ? "Ya existe un registro con esos datos" : "No se pudo guardar. Revisa los campos y los permisos");
    } finally { setSaving(false); }
  };

  const title = { movement: row ? "Editar movimiento" : "Registrar movimiento", member: row ? "Editar empleado" : "Agregar empleado",
    archive: "Eliminar empleado", modelShare: "Editar porcentaje del modelo" };
  const kind = values.kind === "expense" ? "investment" : values.kind;

  return <dialog className="hf-dialog" aria-labelledby="hf-editor-title" ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="hf-editor-title">{title[type] ?? `Agregar ${catalog[type]?.toLowerCase()}`}</h2>
      <div className="hf-form">
        {type === "movement" && <>
          <DateField label="Fecha" value={values.day} onChange={(value) => set("day", value)} required />
          <Choice label="Tipo" value={kind} rows={[{ id: "investment", name: "Inversión" }, { id: "income", name: "Ingreso" }]}
            onChange={(value) => set("kind", value)} placeholder="Selecciona un tipo" required />
          <CategoryPicker categories={data.categories} value={values.category} onChange={(value) => set("category", value)} onSaved={onChange} />
          {select("Modelo", "creator_id", data.creators)}
          {select("Plataforma", "platform_id", data.platforms)}
          {field(kind === "income" ? "Ingreso a agencia ($)" : "Importe ($)", "amount",
            { type: "number", step: "0.01", min: kind === "income" ? undefined : "0.01", required: true })}
          <div className="hf-full-field">{field("Descripción", "description", { maxLength: 500 })}</div>
        </>}
        {type === "archive" && <p>Retirar a {row.name} del listado de empleados y conservar su historial</p>}
        {type === "member" && !row?.agencykey_id && <>
          {field("Nombre", "name", { maxLength: 120, required: true })}
          {field("Rol", "role", { maxLength: 120, required: true })}
        </>}
        {(type === "modelShare" || type === "member" && row?.agencykey_id) &&
          <p>{row.name} · {row.role}</p>}
        {(memberShare || type === "modelShare") && <>
          {field("Porcentaje", "percent", { type: "number", min: 0, max: 100, step: "0.01", required: true })}
          <DateField label="Vigente desde" value={values.effective_on} onChange={(value) => set("effective_on", value)} required />
        </>}
        {byEmployee && <p>Ventas netas atribuidas en todas las cuentas de AgencyKey.
          {!row?.agencykey_id && " Se necesita una cuenta de AgencyKey para atribuir ventas."}</p>}
        {memberShare && !byEmployee && <fieldset className="hf-model-options"><legend>Modelos asignados</legend>
          {availableModels.map(({ id, name }) => <label key={id}>
            <input type="checkbox" checked={values.creator_ids.includes(id)} onChange={(event) =>
              set("creator_ids", event.target.checked ? [...values.creator_ids, id] : values.creator_ids.filter((value) => value !== id))} />
            {name}
          </label>)}
          {!availableModels.length && <p>Sin modelos disponibles</p>}
        </fieldset>}
        {catalog[type] && field("Nombre", "name", { maxLength: 120, required: true })}
      </div>
      {row && (memberShare || type === "modelShare") && <PaymentHistory type={type} person={row.id} onConfirmed={onChange} />}
      {error && <p className="hf-notice" role="alert">{error}</p>}
      <div className="hf-actions"><button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" className="hf-primary" disabled={saving || Boolean(row?.archived_on && memberShare)}>{saving ? "Guardando…" : type === "archive" ? "Eliminar" : "Guardar"}</button></div>
    </form>
  </dialog>;
}
