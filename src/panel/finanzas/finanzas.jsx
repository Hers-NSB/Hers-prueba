import AdminRefresh from "../AdminRefresh";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileCheck, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import AdminLoading from "../AdminLoading.jsx";
import { dateKey, financeBreakdown, isActiveFinanceEntry, kinds, missingAgencyKeyDays, monthRange, salesProfit, usd } from "./finance";
import callApi from "../integrations/connectorApi";
import PeriodPicker from "./PeriodPicker";
import { effectiveShare, isChatter } from "./distribution";
import CategoryPicker from "./CategoryPicker";
import CategoryDescription from "./CategoryDescription";
import PaymentHistory from "./PaymentHistory";
import "./finanzas.css";

import Overview from "./Overview";
import { inPeriod, loadOverview, readOverviewTotals, readPayroll, readRows } from "./financeData";
import { AdminError, useAdminRefresh } from "../adminActions";

const empty = { movements: [], sales: [], commissions: [], creators: [], platforms: [], members: [], categories: [], rates: [], balance: null, movementCategories: [], currentPay: {}, currentPaySales: {}, payPeriod: null };
const catalog = { platform: "Plataforma" };
const tabs = ["Resumen", "Movimiento", "Empleados"];
const movementPageSize = 50;

async function loadFinance(range, signal) {
  const { data: allowed, error } = await supabase.rpc("finance_is_admin").abortSignal(signal);
  if (error?.code === "42501" || !error && !allowed) return null;
  if (error) throw error;
  const [period, creators, platforms, members, categories, rates, payroll, overview] = await Promise.all([
    loadOverview(range, signal),
    readRows("finance_creators", ["name", "id"], signal),
    readRows("finance_platforms", ["name", "id"], signal),
    readRows("finance_members", ["name", "id"], signal),
    readRows("finance_categories", ["name"], signal),
    readRows("finance_model_shares", ["effective_on", "id"], signal),
    readPayroll(signal),
    readOverviewTotals(signal),
  ]);
  return { ...period, ...payroll, ...overview, creators, platforms, members, categories, rates };
}

export default function Finanzas({ refreshRequested, clearRefresh }) {
  const [filters, setFilters] = useState(monthRange);
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState(tabs[0]);
  const [revision, refresh] = useState(0);
  const loadedRevision = useRef(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState(null);
  const [payments, setPayments] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [payrollError, setPayrollError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [directoryError, setDirectoryError] = useState(null);
  const [directoryRevision, refreshDirectory] = useState(null);
  const [movementFilters, setMovementFilters] = useState({});

  const busy = loading || updating;

  useEffect(() => {
    if (!filters.from || !filters.to || filters.from > filters.to) return;
    const controller = new AbortController();
    const read = loadedRevision.current === revision ? loadOverview : loadFinance;
    read(filters, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (read === loadFinance) {
        loadedRevision.current = result ? revision : null;
        setAccess(Boolean(result));
      }
      setData((current) => result ? { ...current, ...result } : empty);
      setLoading(false);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      console.error("Finanzas", error.code || error.message);
      setLoadError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [filters, revision]);

  useEffect(() => {
    if (!access || directoryRevision === null) return;
    const controller = new AbortController();
    callApi("/employees", "POST", undefined, controller.signal).then(() => {
      if (controller.signal.aborted) return;
      setDirectoryError(null);
      reload();
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setDirectoryError(error);
      if (directoryRevision > 0) reload();
    });
    return () => controller.abort();
  }, [access, directoryRevision]);

  useEffect(() => {
    if (tab !== "Empleados" || !access || busy) return;
    let request;
    const checkPeriod = async () => {
      if (document.visibilityState !== "visible" || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const payroll = await readPayroll(controller.signal);
        if (!controller.signal.aborted) {
          setPayrollError("");
          setData((current) => ({ ...current, ...payroll }));
        }
      } catch (error) {
        if (!controller.signal.aborted) setPayrollError(error.message || "No se pudo consultar la quincena");
      } finally {
        request = undefined;
      }
    };
    const timer = window.setInterval(checkPeriod, 60_000);
    document.addEventListener("visibilitychange", checkPeriod);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkPeriod);
    };
  }, [access, busy, tab]);

  async function findDaysToSync(range, today, refreshToday = false) {
    if (!range?.from || !range.to) return [];
    const sales = range.from === filters.from && range.to === filters.to ? data.sales
      : await readRows("finance_agencykey_sales", ["day", "creator_id"], undefined, inPeriod(range), "day,creator_id,net");
    return missingAgencyKeyDays(range, sales, data.creators, today, refreshToday);
  }

  function updateFilters(period) {
    if (period.from === filters.from && period.to === filters.to) return;
    setLoading(true);
    setLoadError(false);
    setSyncError("");
    setFilters(period);
  }

  function reload() {
    setLoading(true);
    setLoadError(false);
    refresh((value) => value + 1);
  }
  const invalid = !filters.from || !filters.to || filters.from > filters.to;

  async function syncDays(days) {
    setSyncError("");
    if (!days.length) return 0;
    setUpdating(true);
    let synced = 0;
    const errors = [];
    try {
      for (const day of days) {
        try {
          const result = await callApi("/sync", "POST", { day });
          if (result.future) break;
          if (!result.finalized && !result.reserved) synced += 1;
        } catch (error) {
          errors.push(error.message);
          if (error.status === 429 || /\[(?:CON-|AK-KEY-MISSING)/.test(error.message)) break;
        }
      }
      if (errors.length) setSyncError([
        synced > 0 && `Días actualizados: ${synced}.`,
        errors.length > 1 && `Días con error: ${errors.length}.`,
        errors[0],
      ].filter(Boolean).join(" "));
    } finally {
      setUpdating(false);
    }
    return synced;
  }

  async function update() {
    if (updating || (tab === "Resumen" && invalid)) return;
    if (tab === "Movimiento") {
      reload();
      return;
    }
    const today = data.payPeriod?.day ?? dateKey(new Date());
    const range = tab === "Empleados" ? data.payPeriod : filters;
    setUpdating(true);
    try {
      await syncDays(await findDaysToSync(range, today, true));
    } catch {
      setSyncError("No se pudo comprobar qué días faltan por sincronizar");
    } finally {
      setUpdating(false);
    }
    if (tab === "Empleados") {
      setLoading(true);
      refreshDirectory((value) => (value ?? 0) + 1);
    } else {
      reload();
    }
  }

  const refreshAction = !busy && access && !(tab === "Resumen" && invalid) ? update
    : !busy && access === null ? reload : null;
  useAdminRefresh("finance", refreshAction, refreshRequested, clearRefresh, busy);

  const paymentPerson = payments && (payments.type === "modelShare" ? data.creators : data.members)
    .find(({ id }) => id === payments.person.id);
  const paymentRate = payments && effectiveShare(data.rates, payments.recipient, data.payPeriod?.day ?? dateKey(new Date()));
  return <section className="hf hf-finance" aria-label="Finanzas">
    <header className="hf-header">
      <div><h1>Finanzas {(refreshRequested || (busy && access)) && <AdminRefresh busy section="Finanzas" />}</h1><p>Ventas de plataforma y resultados de la agencia</p></div>
    </header>
    <AdminError id="finance-access" section="Finanzas" message={access === false ? "Tu cuenta no tiene acceso a Finanzas" : ""} />
    <AdminError id="finance-payroll" section="Finanzas" message={payrollError} />
    <AdminError id="finance-sync" section="Finanzas" message={syncError} />
    <AdminError id="finance-load" section="Finanzas" message={loadError ? "No se pudieron actualizar los datos" : ""} />
    {access !== false && <>
      <nav className="hf-tabs" aria-label="Secciones de Finanzas">
        {tabs.map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      {tab === "Resumen" && <div className="hf-toolbar">
        <PeriodPicker value={filters} onChange={updateFilters} disabled={busy || !access} />
      </div>}
      {tab === "Resumen" && invalid && <p className="hf-notice" role="alert">Selecciona un período válido</p>}
      {loading && access === null && <AdminLoading>Cargando Finanzas…</AdminLoading>}
      {access && <div aria-busy={busy}>
        {tab === "Resumen" && <Overview data={data} range={filters}>
          <div className="hf-breakdowns">
            <Breakdown title="Por modelo" label="Modelo" data={data} dimension="model" catalog={data.creators} />
            <Breakdown title="Por plataforma" label="Plataforma" data={data} dimension="platform" catalog={data.platforms} />
          </div>
        </Overview>}
        {tab === "Movimiento" && <Movements data={data} revision={revision} filters={movementFilters} onFilter={setMovementFilters}
          onEdit={(row) => setEditor({ type: "movement", row })} />}
        {tab === "Empleados" && <Employees data={data} directoryError={directoryError}
          onEdit={(type, row) => setEditor({ type, row })} onPayments={setPayments} />}
      </div>}
      {payments && paymentPerson && <PaymentHistory key={payments.recipient} {...payments} person={paymentPerson}
        rate={paymentRate}
        currentPeriod={payments.type === "modelShare" || isChatter(paymentPerson.role) || paymentRate ? data.payPeriod : null}
        currentAmount={data.currentPay[payments.recipient]} currentNet={data.currentPaySales[payments.recipient]}
        financeRevision={revision}
        onEdit={() => setEditor({ type: payments.type, row: paymentPerson })}
        onArchive={() => setEditor({ type: "archive", row: paymentPerson })} onConfirmed={reload} onClose={() => setPayments(null)} />}
      {editor && <Editor editor={editor} data={data} onChange={reload} onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); reload(); }} />}

    </>}
  </section>;
}

function Choice({ label, value, rows, onChange, placeholder = "Otros", required = false }) {
  return <label>{label}<span className="hf-choice">
    <select className="hf-select-trigger" required={required} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {rows.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select><ChevronDown size={17} aria-hidden="true" />
  </span></label>;
}

function Table({ headings, rows, labelledBy, emptyText = "Sin registros para este período" }) {
  return rows.length ? <div className="hf-table" tabIndex={0}><table role="table" aria-labelledby={labelledBy}>
    <thead role="rowgroup"><tr role="row">{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody role="rowgroup">{rows.map(([id, cells]) => <tr role="row" key={id}>{cells.map((cell, index) => <td role="cell" key={index} data-label={headings[index]}>{cell}</td>)}</tr>)}</tbody>
  </table></div> : <p className="hf-empty">{emptyText}</p>;
}

const findName = (rows, id) => rows.find((row) => row.id === id)?.name || "—";

function Breakdown({ data, dimension, title, label, catalog }) {
  const rows = financeBreakdown(data, dimension).map((row) => ({
    ...row,
    name: row.id ? findName(catalog, row.id) : "Otros",
    profit: salesProfit(row.net, row.expenses),
  })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  return <section className="hf-section">
    <h2>{title}</h2>
    <Table headings={[label, "Ganancia", "Inversión", "Ventas netas"]}
      rows={rows.map(({ id, name, profit, expenses, net }) => [id ?? "unassigned", [name, usd(profit == null ? null : Math.abs(profit)), usd(expenses), usd(net)]])} />
  </section>;
}


function Movements({ data, revision, filters, onFilter, onEdit }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const hasNext = rows.length > movementPageSize;
  useEffect(() => {
    const { from, to, kind, category, creator, platform, updated } = filters;
    const controller = new AbortController();
    const filter = (initialQuery) => {
      let query = initialQuery;
      if (from) query = query.gte("day", from);
      if (to) query = query.lte("day", to);
      if (kind) query = kind === "investment" ? query.in("kind", ["investment", "expense"]) : query.eq("kind", kind);
      if (category) query = query.eq("category", category);
      if (creator) query = creator === "none" ? query.is("creator_id", null) : query.eq("creator_id", creator);
      if (platform) query = platform === "none" ? query.is("platform_id", null) : query.eq("platform_id", platform);
      if (updated) query = updated === "yes" ? query.not("updated_at", "is", null) : query.is("updated_at", null);
      return query;
    };
    async function readPage() {
      const start = page * movementPageSize;
      try {
        const { data, error } = await filter(supabase.from("finance_movements").select("*"))
          .order("day", { ascending: false }).order("id", { ascending: false })
          .range(start, start + movementPageSize).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw error;
        setRows(data);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    readPage();
    return () => controller.abort();
  }, [filters, revision, page]);

  function applyFilter(change) {
    setLoading(true);
    setError(false);
    setPage(0);
    onFilter(change);
  }

  const select = (label, key, options, placeholder = "Todos") => <Choice label={label} value={filters[key]}
    rows={options} placeholder={placeholder} onChange={(value) => applyFilter((current) => ({ ...current, [key]: value }))} />;
  const categories = [...new Set([...data.categories.map(({ name }) => name), ...data.movementCategories])].sort();
  return <section className="hf-section">
    <div className="hf-summary-head"><h2>Movimiento</h2><button type="button" className="hf-primary" onClick={() => onEdit()}><Plus size={16} /> Registrar movimiento</button></div>
    <div className="hf-movement-filters" role="group" aria-label="Filtros de movimientos">
      <div className="hf-date-filter">
        <PeriodPicker label="Fechas" value={filters} allowFuture onChange={({ from, to }) =>
          (from !== filters.from || to !== filters.to) && applyFilter((current) => ({ ...current, from, to }))} />
        <button type="button" onClick={() => applyFilter({})}>Limpiar filtros</button>
      </div>
      {select("Tipo", "kind", [{ id: "investment", name: kinds.investment }, { id: "income", name: kinds.income }])}
      {select("Categoría", "category", categories.map((name) => ({ id: name, name })), "Todas")}
      {select("Modelo", "creator", [...data.creators, { id: "none", name: "Otros" }])}
      {select("Plataforma", "platform", [...data.platforms, { id: "none", name: "Otros" }], "Todas")}
      {select("Actualizado", "updated", [{ id: "yes", name: "Sí" }, { id: "no", name: "No" }])}
    </div>
    <AdminError id="finance-movements" section="Finanzas" message={error ? "No se pudieron consultar los movimientos" : ""} />
    {error ? null : loading ? <p role="status">Cargando movimientos…</p> :
    <Table headings={["Fecha", "Tipo", "Categoría", "Modelo", "Plataforma", "Importe", "Acción"]}
      emptyText="Sin movimientos para estos filtros"
      rows={rows.slice(0, movementPageSize).map((row) => [row.id, [row.day, kinds[row.kind],
        <CategoryDescription name={row.category} description={row.description} />,
        row.creator_id ? findName(data.creators, row.creator_id) : "Otros",
        row.platform_id ? findName(data.platforms, row.platform_id) : "Otros", usd(row.amount),
        <div className="hf-actions">{row.finance_payment_id ? <span>Pago confirmado</span>
          : <button type="button" aria-label={`Editar ${kinds[row.kind]} del ${row.day}`} onClick={() => onEdit(row)}>Editar</button>}
          {row.updated_at && <span className="hf-updated" title={`Actualizado el ${new Date(row.updated_at).toLocaleString("es-VE")}`}>
            <FileCheck size={17} aria-label="Movimiento actualizado" />
          </span>}
        </div>]])} />}
    {(page > 0 || hasNext) && <nav className="hf-actions" aria-label="Páginas de movimientos">
      <button type="button" disabled={loading || page === 0} onClick={() => {
        setLoading(true);
        setPage(page - 1);
      }}>Anterior</button>
      <span>Página {page + 1}</span>
      <button type="button" disabled={loading || error || !hasNext} onClick={() => {
        setLoading(true);
        setPage(page + 1);
      }}>Siguiente</button>
    </nav>}
  </section>;
}

const percentage = new Intl.NumberFormat("es-VE", { style: "percent", maximumFractionDigits: 2 });
const percentLabel = (value) => percentage.format(Number(value) / 100);

function Employees({ data, directoryError, onEdit, onPayments }) {
  const currentDay = data.payPeriod?.day ?? dateKey(new Date());
  const chatters = data.members.filter(({ role }) => isChatter(role));
  const creators = data.creators.filter(isActiveFinanceEntry);
  const participants = [
    ...data.members.map((row) => [row, "member", `chatter:${row.id}`, isActiveFinanceEntry(row)]),
    ...data.creators.map((row) => [{ ...row, role: "Modelo" }, "modelShare", `model:${row.id}`, isActiveFinanceEntry(row)]),
  ].sort(([a], [b]) => a.name.localeCompare(b.name, "es"));
  const headings = ["Nombre", "Rol", "Porcentaje", "Ventas netas ($)", "Pago ($)", "Acciones"];
  const isModel = ([row, type]) => type === "modelShare"
    || row.role?.split(",").some((role) => role.trim().toLowerCase() === "modelo");
  const toRow = ([row, type, recipient, active]) => {
    const rate = effectiveShare(data.rates, recipient, currentDay);
    const eligible = type === "modelShare" || isChatter(row.role) || Boolean(rate);
    const payout = data.currentPay[recipient] ?? (data.payPeriod?.day === data.payPeriod?.from && row.agencykey_id ? 0 : null);
    const amount = payout != null && rate ? usd(payout) : !eligible || !rate ? "—"
      : rate.basis === "employee_sales" && !row.agencykey_id ? "Pendiente de vincular" : "Pendiente de sincronizar";
    return [recipient, [active ? row.name : <>{row.name} <small className="hf-employee-status">Inactivo</small></>, row.role,
      rate ? percentLabel(rate.percent) : "—", eligible ? usd(data.currentPaySales[recipient]) : "—", amount,
      <div className="hf-actions">
        <button type="button" onClick={() => onPayments({ type, person: row, recipient })}>Pagos</button>
      </div>]];
  };
  const models = participants.filter(isModel).map(toRow);
  const otherEmployees = participants.filter((entry) => !isModel(entry)).map(toRow);
  return <>
    <div className="hf-summary-head">
      <h2>Empleados</h2>
      <div className="hf-actions">
        <button type="button" onClick={() => onEdit("member")}><Plus size={16} /> Agregar empleado</button>
      </div>
    </div>
    <p className="hf-employee-count">{creators.length} modelos · {chatters.length} chatters
      {data.payPeriod && ` · Corte actual: ${data.payPeriod.from} a ${data.payPeriod.to}`}</p>
    <AdminError id="finance-directory" section="Finanzas" message={directoryError?.message.startsWith("[AK-DIRECTORY-CONNECT]")
      ? "Autoriza el directorio de AgencyKey en Conectores para sincronizar el listado."
      : directoryError?.message} />
    <section className="hf-section" aria-labelledby="hf-models-title">
      <h2 id="hf-models-title">Modelos</h2>
      <Table labelledBy="hf-models-title" headings={headings} rows={models} emptyText="Sin modelos registrados" />
    </section>
    <section className="hf-section" aria-labelledby="hf-other-employees-title">
      <h2 id="hf-other-employees-title">Otros empleados</h2>
      <Table labelledBy="hf-other-employees-title" headings={headings} rows={otherEmployees} emptyText="Sin otros empleados registrados" />
    </section>
    <section className="hf-section">
      <div className="hf-actions">
        <button type="button" onClick={() => onEdit("platform")}><Plus size={16} /> Agregar plataforma</button>
      </div>
      <Table headings={["Plataforma"]} emptyText="Sin plataformas registradas" rows={data.platforms.map(({ id, name }) => [id, [name]])} />
    </section>
  </>;
}

function Editor({ editor: { type, row }, data, onClose, onSaved, onChange }) {
  const today = dateKey(new Date());
  const rateDay = data.payPeriod?.day ?? today;
  const recipient = type === "modelShare" ? `model:${row.id}` : row && `chatter:${row.id}`;
  const share = effectiveShare(data.rates, recipient, rateDay);
  const initialValues = { day: today, kind: "investment", percent: 0, creator_ids: [],
    ...row, ...(share && { percent: share.percent, creator_ids: share.creator_ids }) };
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const availableModels = data.creators.filter((creator) => isActiveFinanceEntry(creator) || values.creator_ids.includes(creator.id));
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
        const payload = { day, kind, category, description: description ?? "",
          creator_id: creator_id || null, platform_id: platform_id || null, amount,
          gross: kind === "income" ? row?.gross ?? null : null, net: kind === "income" ? row?.net ?? null : null };
        const table = supabase.from("finance_movements");
        request = row ? table.update(payload).eq("id", row.id).select("id").single() : table.insert(payload);
      } else if (type === "archive") {
        request = supabase.from("finance_members").update({ archived_on: today }).eq("id", row.id).select("id").single();
      } else if (memberShare || type === "modelShare") {
        if (memberShare && !byEmployee && Number(values.percent) > 0 && !values.creator_ids.length) {
          throw new Error("Selecciona al menos un modelo");
        }
        request = supabase.rpc("finance_save_current_pay_rate", {
          p_member_id: memberShare ? row?.id ?? null : null, p_creator_id: type === "modelShare" ? row.id : null,
          p_name: memberShare ? values.name : null, p_role: memberShare ? values.role : null,
          p_percent: Number(values.percent), p_creator_ids: memberShare && !byEmployee ? values.creator_ids : [],
        });
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

  return <dialog className="hf-dialog hf-finance-dialog" aria-labelledby="hf-editor-title" ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="hf-editor-title">{title[type] ?? `Agregar ${catalog[type]?.toLowerCase()}`}</h2>
      <div className="hf-form">
        {type === "movement" && <>
          <PeriodPicker label="Fecha" value={{ from: values.day }} single allowFuture
            onChange={({ from }) => set("day", from)} />
          <Choice label="Tipo" value={kind} rows={[{ id: "investment", name: "Inversión" }, { id: "income", name: "Ingreso" }]}
            onChange={(value) => set("kind", value)} placeholder={null} required />
          <CategoryPicker categories={data.categories} value={values.category} onChange={(value) => set("category", value)} onSaved={onChange} />
          {select("Modelo", "creator_id", data.creators)}
          {select("Plataforma", "platform_id", data.platforms)}
          {field(kind === "income" ? "Ingreso a agencia ($)" : "Importe ($)", "amount",
            { type: "number", step: "0.01", min: kind === "income" ? undefined : "0.01", required: true })}
          <label className="hf-full-field">Descripción
            <textarea maxLength={500} rows={3} value={values.description ?? ""}
              onChange={(event) => set("description", event.target.value)} />
          </label>
        </>}
        {type === "archive" && <p>Retirar a {row.name} del listado de empleados y conservar su historial</p>}
        {memberShare && !row?.agencykey_id && <fieldset className="hf-edit-group">
          <legend>Datos del empleado</legend>
          {field("Nombre", "name", { maxLength: 120, required: true })}
          {field("Rol", "role", { maxLength: 120, required: true })}
        </fieldset>}
        {(type === "modelShare" || memberShare && row?.agencykey_id) &&
          <p className="hf-full-field">{row.name}{row.role && ` · ${row.role}`}</p>}
        {(memberShare || type === "modelShare") && <fieldset className="hf-edit-group">
          <legend>Porcentaje de pago</legend>
          {field("Porcentaje", "percent", { type: "number", min: 0, max: 100, step: "0.01", required: true })}
          <p className="hf-full-field">El porcentaje se aplica a toda la quincena actual.</p>
          {byEmployee && <p className="hf-full-field">Ventas netas atribuidas en todas las cuentas de AgencyKey.
            {!row?.agencykey_id && " Se necesita una cuenta de AgencyKey para atribuir ventas."}</p>}
        </fieldset>}
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
      {error && <p className="hf-notice" role="alert">{error}</p>}
      <div className="hf-actions"><button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" className="hf-primary" disabled={saving || Boolean(row?.archived_on && memberShare)}>{saving ? "Guardando…" : type === "archive" ? "Eliminar" : "Guardar"}</button></div>
    </form>
  </dialog>;
}
