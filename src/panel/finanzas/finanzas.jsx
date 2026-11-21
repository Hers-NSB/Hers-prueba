import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BarChart3, CircleDollarSign, FileCheck, Plus, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { dateKey, financeBreakdown, hasOperatingAmounts, investmentTotal, kinds, metricIf, monthRange, netSales, summarize, usd } from "./finance";
import callApi from "../integrations/connectorApi";
import PeriodPicker from "./PeriodPicker";
import { calculateModelDistribution, effectiveShare } from "./distribution";
import CategoryPicker from "./CategoryPicker";
import Distribution from "./Distribution";
import "./finanzas.css";

const FinanceCharts = lazy(() => import("./FinanceCharts"));

const empty = { movements: [], sales: [], commissions: [], creators: [], platforms: [], members: [], categories: [], distributionPlans: [], rates: [], availability: [], allMovements: [] };
const catalog = { platform: "Plataforma", creator: "Modelo" };
const catalogTables = { platform: "finance_platforms", creator: "finance_creators" };
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
  const [allMovements, sales, creators, platforms, members, categories, distributionPlans, rates, availability] = await Promise.all([
    readRows("finance_movements", ["day", "id"]),
    readRows("finance_agencykey_sales", ["day", "creator_id"], inPeriod),
    readRows("finance_creators", ["name", "id"]),
    readRows("finance_platforms", ["name", "id"]),
    readRows("finance_members", ["name", "id"]),
    readRows("finance_categories", ["name"]),
    readRows("finance_distribution_plans", ["effective_on", "revision"]),
    readRows("finance_model_shares", ["effective_on", "id"]),
    readRows("finance_member_availability", ["effective_on", "member_id"]),
  ]);
  return { ...empty, movements: allMovements.filter(({ day }) => day >= from && day <= to),
    allMovements, sales, creators, platforms, members, categories, distributionPlans, rates, availability };
}

export default function Finanzas() {
  const [filters, setFilters] = useState(monthRange);
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState(tabs[0]);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [directory, setDirectory] = useState(null);
  const [directoryError, setDirectoryError] = useState(null);
  const [directoryRevision, refreshDirectory] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const directoryPopup = useRef(null);
  const [movementFilters, setMovementFilters] = useState({});

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

  useEffect(() => {
    if (tab !== "Empleados") return;
    const controller = new AbortController();
    callApi("/employees", "POST", undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setDirectory(result);
        setDirectoryError(null);
        refresh((value) => value + 1);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setDirectoryError(error);
    });
    return () => controller.abort();
  }, [tab, directoryRevision]);

  useEffect(() => {
    function complete(event) {
      if (event.origin !== window.location.origin || event.source !== directoryPopup.current ||
          event.data?.type !== "hers-agencykey-directory") return;
      if (event.data.connected) refreshDirectory((value) => value + 1);
      else setDirectoryError(new Error("No se pudo conectar el directorio de AgencyKey"));
    }
    window.addEventListener("message", complete);
    return () => window.removeEventListener("message", complete);
  }, []);

  async function connectDirectory() {
    if (connecting) return;
    const popup = window.open("about:blank", "hers-agencykey-directory", "popup,width=640,height=700");
    directoryPopup.current = popup;
    setConnecting(true);
    try {
      const { authorize } = await callApi("/agencykey-directory/connect", "POST");
      if (popup) popup.location.replace(authorize);
      else window.location.assign(authorize);
    } catch (error) {
      popup?.close();
      setDirectoryError(error);
    } finally {
      setConnecting(false);
    }
  }

  const updateFilters = (period) => {
    if (period.from === filters.from && period.to === filters.to) return;
    setState("loading");
    setSyncError("");
    setFilters(period);
  };
  const reload = () => { setState("loading"); refresh((value) => value + 1); };
  const invalid = !filters.from || !filters.to || filters.from > filters.to;
  const totals = summarize(data);
  const distribution = calculateModelDistribution(data.sales, data.distributionPlans, data.members, data.rates, data.availability);

  async function update() {
    if (updating || invalid) return;
    setUpdating(true);
    setSyncError("");
    let synced = 0;
    try {
      for (let timestamp = Date.parse(filters.from); timestamp <= Date.parse(filters.to); timestamp += 86_400_000) {
        const day = new Date(timestamp).toISOString().slice(0, 10);
        const result = await callApi("/sync", "POST", { day });
        if (result.future) break;
        synced += 1;
      }
    } catch (error) {
      setSyncError(synced ? `${synced} días actualizados. ${error.message}` : error.message);
    } finally {
      reload();
      if (tab === "Empleados") refreshDirectory((value) => value + 1);
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
      {tab === "Resumen" && <div className="hf-toolbar">
        <PeriodPicker value={filters} onChange={updateFilters} disabled={updating} />
      </div>}
      {syncError && <p className="hf-notice" role="alert">{syncError}</p>}
      {invalid && <p className="hf-notice" role="alert">Selecciona un período válido</p>}
      {!invalid && state === "loading" && <p className="hf-notice" role="status">Cargando Finanzas…</p>}
      {!invalid && state === "error" && <p className="hf-notice" role="alert">No se pudieron cargar los datos de Finanzas <button type="button" onClick={reload}>Reintentar</button></p>}
      {!invalid && state === "ready" && <>
        {tab === "Resumen" && <Overview totals={totals} data={data} distribution={distribution} />}
        {tab === "Movimiento" && <Movements data={data} filters={movementFilters} onFilter={setMovementFilters}
          onEdit={(row) => setEditor({ type: "movement", row })} />}
        {tab === "Empleados" && <Employees data={data} directory={directory} directoryError={directoryError} connecting={connecting}
          onConnect={connectDirectory} onRefresh={() => refreshDirectory((value) => value + 1)} onEdit={(type, row) => setEditor({ type, row })} distribution={distribution} />}
      </>}
      {editor && <Editor editor={editor} data={data} directory={directory} onClose={() => { setEditor(null); reload(); }}
        onSaved={() => { setEditor(null); reload(); }} />}

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
    <Table headings={[label, "Ingreso agencia", "Inversión", "Ventas netas"]}
      rows={rows.map(({ id, name, income, expenses, net }) => [id ?? "unassigned", [name, usd(income), usd(expenses), usd(net)]])} />
  </section>;
}

function Overview({ totals, data, distribution }) {
  const { movements, sales } = data;
  const vault = distribution.payouts.get("hers");
  const manualIncome = metricIf(movements, "income", totals.agency);
  const agencyIncome = manualIncome == null && vault == null ? null : (manualIncome ?? 0) + (vault ?? 0);
  const hasOperations = hasOperatingAmounts(data) || vault != null;
  const investment = investmentTotal(movements, totals);
  const cards = [
    ["Ingreso de la agencia", agencyIncome, Wallet, "income"],
    ["Inversión", investment, ArrowUpRight, "expenses"],
    ["Ganancia", hasOperations ? totals.afterInvestment + (vault ?? 0) : null, CircleDollarSign, "profit"],
    ["Ventas netas", netSales(sales, movements), BarChart3, "sales"],
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
    <dl className="hf-financial-detail"><div><dt>Bóveda de Agencia HERS</dt><dd>{usd(vault)}</dd></div></dl>
    <div className="hf-breakdowns">
      <Breakdown title="Por modelo" label="Modelo" data={data} dimension="model" catalog={data.creators} />
      <Breakdown title="Por plataforma" label="Plataforma" data={data} dimension="platform" catalog={data.platforms} />
    </div>
  </>;
}

function Movements({ data, filters, onFilter, onEdit }) {
  const change = (key, value) => onFilter((current) => ({ ...current, [key]: value }));
  const input = (label, key, type = "text") => <label>{label}
    <input type={type} value={filters[key] ?? ""} onChange={(event) => change(key, event.target.value)} />
  </label>;
  const select = (label, key, rows, placeholder = "Todos") => <Choice label={label} value={filters[key]}
    rows={rows} placeholder={placeholder} onChange={(value) => change(key, value)} />;
  const categories = [...new Set([...data.categories.map(({ name }) => name), ...data.allMovements.map(({ category }) => category)])].sort();
  const matches = (value, term) => !term || String(value ?? "").toLocaleLowerCase("es").includes(term.trim().toLocaleLowerCase("es"));
  const rows = data.allMovements.filter((row) =>
    (!filters.from || row.day >= filters.from) &&
    (!filters.to || row.day <= filters.to) &&
    (!filters.kind || (row.kind === "expense" ? "investment" : row.kind) === filters.kind) &&
    (!filters.category || row.category === filters.category) &&
    (!filters.creator || (row.creator_id ?? "none") === filters.creator) &&
    (!filters.platform || (row.platform_id ?? "none") === filters.platform) &&
    matches(row.description, filters.description) &&
    matches(Number(row.amount).toFixed(2), filters.amount?.replace(",", ".")) &&
    (!filters.updated || Boolean(row.updated_at) === (filters.updated === "yes")));
  return <section className="hf-section">
    <div className="hf-summary-head"><h2>Movimiento</h2><button type="button" className="hf-primary" onClick={() => onEdit()}><Plus size={16} /> Registrar movimiento</button></div>
    <div className="hf-movement-filters" role="group" aria-label="Filtros de movimientos">
      {input("Desde", "from", "date")}
      {input("Hasta", "to", "date")}
      {select("Tipo", "kind", [{ id: "investment", name: kinds.investment }, { id: "income", name: kinds.income }])}
      {select("Categoría", "category", categories.map((name) => ({ id: name, name })), "Todas")}
      {select("Modelo", "creator", [...data.creators, { id: "none", name: "Sin asignar" }])}
      {select("Plataforma", "platform", [...data.platforms, { id: "none", name: "Sin asignar" }], "Todas")}
      {input("Importe (USD)", "amount")}
      {input("Descripción", "description")}
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
        <div className="hf-actions"><button type="button" aria-label={`Editar ${kinds[row.kind]} del ${row.day}`} onClick={() => onEdit(row)}>Editar</button>
          {row.updated_at && <span className="hf-updated" title={`Actualizado el ${new Date(row.updated_at).toLocaleString("es-VE")}`}>
            <FileCheck size={17} aria-label="Movimiento actualizado" />
          </span>}
        </div>]])} />
  </section>;
}

const isCurrent = (entry) => entry.agencykey_available !== false;
const percentage = new Intl.NumberFormat("es-VE", { style: "percent", maximumFractionDigits: 2 });
const percentLabel = (value) => percentage.format(Number(value) / 100);

function Employees({ data, directory, directoryError, connecting, onConnect, onRefresh, onEdit, distribution }) {
  const currentDay = dateKey(new Date());
  const members = data.members.filter((row) => !row.archived_on && isCurrent(row));
  const creators = data.creators.filter(isCurrent).map((row) => ({ ...row, role: "Modelo" }));
  const rows = [
    ...members.map((row) => [row, "member", `chatter:${row.id}`]),
    ...creators.map((row) => [row, "modelShare", `model:${row.id}`]),
  ].sort(([a], [b]) => a.name.localeCompare(b.name, "es"));
  return <>
    <div className="hf-summary-head">
      <h2>Empleados</h2>
      <div className="hf-actions">
        <button type="button" onClick={() => onEdit("agencykey")} disabled={!directory || Boolean(directoryError)}><Plus size={16} /> Agregar desde AgencyKey</button>
        <button type="button" onClick={() => onEdit("member")}><Plus size={16} /> Agregar empleado</button>
      </div>
    </div>
    {directoryError && <div className="hf-actions hf-directory-actions">
      <button type="button" onClick={onConnect} disabled={connecting}>Conectar directorio de AgencyKey</button>
      <button type="button" onClick={onRefresh}>Reintentar consulta</button>
      {!directoryError.message.startsWith("[AK-DIRECTORY-CONNECT]") && <p role="alert">{directoryError.message}</p>}
    </div>}
    <Table headings={["Nombre", "Rol", "Origen", "Modelos asignados", "Porcentaje", "Ganancia del período", "Acciones"]} emptyText="Sin empleados registrados"
      rows={rows.map(([row, type, recipient]) => {
        const rate = effectiveShare(data.rates, recipient, currentDay);
        return [recipient, [row.name, row.role, row.agencykey_id ? "AgencyKey" : "Manual",
          type === "modelShare" ? row.name : rate?.creator_ids.map((id) => findName(data.creators, id)).join(", ") || "—",
          rate ? percentLabel(rate.percent) : "—", usd(distribution.payouts.get(recipient)),
          <div className="hf-actions"><button type="button" onClick={() => onEdit(type, row)}>Editar</button>
            {type === "member" && <button type="button" onClick={() => onEdit("archive", row)}>Eliminar</button>}</div>]];
      })} />
    <Distribution data={data} />
    <section className="hf-section">
      <div className="hf-summary-head"><h2>Catálogos</h2><div className="hf-actions">
        <button type="button" onClick={() => onEdit("creator")}><Plus size={16} /> Agregar modelo</button>
        <button type="button" onClick={() => onEdit("platform")}><Plus size={16} /> Agregar plataforma</button>
      </div></div>
      <Table headings={["Plataforma"]} emptyText="Sin plataformas registradas" rows={data.platforms.map(({ id, name }) => [id, [name]])} />
    </section>
  </>;
}

function Editor({ editor: { type, row }, data, directory, onClose, onSaved }) {
  const today = dateKey(new Date());
  const recipient = type === "modelShare" ? `model:${row.id}` : row && `chatter:${row.id}`;
  const share = effectiveShare(data.rates, recipient, today);
  const initialValues = { day: today, effective_on: today, kind: "investment", percent: 0, creator_ids: [],
    ...row, ...(share && { percent: share.percent, creator_ids: share.creator_ids }) };
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const candidates = directory?.employees ?? [];
  const candidate = candidates.find((entry) => entry.id === values.agencykey_id);
  const availableModels = data.creators.filter((creator) => isCurrent(creator) || values.creator_ids.includes(creator.id));
  const memberShare = type === "member" || type === "agencykey";
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
        if (Number(values.percent) > 0 && !values.creator_ids.length) throw new Error("Selecciona al menos un modelo");
        request = supabase.rpc("finance_save_member_share", {
          p_member_id: row?.id ?? null, p_agencykey_id: candidate?.id ?? null,
          p_name: candidate?.name ?? values.name, p_role: candidate?.role ?? values.role,
          p_effective_on: values.effective_on, p_percent: Number(values.percent), p_creator_ids: values.creator_ids,
        });
      } else if (type === "modelShare") {
        request = supabase.from("finance_model_shares").upsert({
          creator_id: row.id, member_id: null, effective_on: values.effective_on, percent: Number(values.percent),
        }, { onConflict: "member_id,creator_id,effective_on" });
      } else {
        request = supabase.from(catalogTables[type]).insert({ name: values.name.trim() });
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
    agencykey: "Agregar desde AgencyKey", archive: "Eliminar empleado", modelShare: "Editar porcentaje del modelo" };
  const kind = values.kind === "expense" ? "investment" : values.kind;

  return <dialog className="hf-dialog" aria-labelledby="hf-editor-title" ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="hf-editor-title">{title[type] ?? `Agregar ${catalog[type]?.toLowerCase()}`}</h2>
      <div className="hf-form">
        {type === "movement" && <>
          {field("Fecha", "day", { type: "date", required: true })}
          <label>Tipo<select className="hf-select-trigger" value={kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="investment">Inversión</option><option value="income">Ingreso</option>
          </select></label>
          <CategoryPicker categories={data.categories} value={values.category} onChange={(value) => set("category", value)} />
          {field("Descripción", "description", { maxLength: 500 })}
          {select("Modelo", "creator_id", data.creators)}
          {select("Plataforma", "platform_id", data.platforms)}
          {field(kind === "income" ? "Ingreso a agencia (USD)" : "Importe (USD)", "amount",
            { type: "number", step: "0.01", min: kind === "income" ? undefined : "0.01", required: true })}
        </>}
        {type === "archive" && <p>Retirar a {row.name} del listado de empleados y conservar su historial</p>}
        {type === "agencykey" && <Choice label="Empleado" value={candidate?.id} required placeholder="Selecciona un empleado"
          rows={candidates.filter((entry) => !data.members.some((member) => !member.archived_on && member.agencykey_id === entry.id))}
          onChange={(id) => set("agencykey_id", id)} />}
        {type === "member" && !row?.agencykey_id && <>
          {field("Nombre", "name", { maxLength: 120, required: true })}
          {field("Rol", "role", { maxLength: 120, required: true })}
        </>}
        {(candidate || type === "modelShare" || type === "member" && row?.agencykey_id) &&
          <p>{candidate?.name ?? row.name} · {candidate?.role ?? row.role}</p>}
        {(memberShare || type === "modelShare") && <>
          {field("Porcentaje", "percent", { type: "number", min: 0, max: 100, step: "0.01", required: true })}
          {field("Vigente desde", "effective_on", { type: "date", required: true })}
        </>}
        {memberShare && <fieldset className="hf-model-options"><legend>Modelos asignados</legend>
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
        <button type="submit" className="hf-primary" disabled={saving || (type === "agencykey" && !candidate)}>{saving ? "Guardando…" : type === "archive" ? "Eliminar" : "Guardar"}</button></div>
    </form>
  </dialog>;
}
