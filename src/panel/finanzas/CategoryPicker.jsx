import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function CategoryPicker({ categories, value, onChange, onSaved }) {
  const id = useId();
  const [names, setNames] = useState(() => categories.map(({ name }) => name));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setEditing(null); setError(""); };
  const close = () => { setOpen(false); reset(); };
  const edit = (action, selected = "") => { setEditing({ action, selected }); setName(selected); setError(""); };

  async function save() {
    const { action, selected } = editing;
    const next = name.trim();
    if (saving || (action !== "delete" && !next)) return;
    setSaving(true);
    setError("");
    try {
      const table = supabase.from("finance_categories");
      let request;
      if (action === "create") request = table.insert({ name: next });
      if (action === "rename") request = supabase.rpc("finance_rename_category", { p_name: selected, p_new_name: next });
      if (action === "delete") request = table.delete().eq("name", selected);
      const { error: failure } = await request;
      if (failure) throw failure;
      setNames((current) => [...current.filter((item) => item !== selected), ...(action === "delete" ? [] : [next])]);
      if (action === "create" || selected === value) onChange(action === "delete" ? "" : next);
      reset();
      onSaved();
    } catch (failure) {
      setError(failure.code === "23505" ? "Ya existe una categoría con ese nombre" : "No se pudo guardar el cambio");
    } finally {
      setSaving(false);
    }
  }

  const nameForm = <div className="hf-category-edit">
    <label>{editing?.action === "create" ? "Nueva categoría" : "Nombre de la categoría"}
      <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") save(); }} />
    </label>
    <div className="hf-actions">
      <button type="button" disabled={saving} onClick={reset}>Cancelar</button>
      <button type="button" className="hf-primary" disabled={saving || !name.trim()} onClick={save}>Guardar categoría</button>
    </div>
  </div>;

  return <div className="hf-category">
    <span>Categoría</span>
    <button type="button" className="hf-select-trigger hf-period-trigger" aria-haspopup="dialog"
      aria-label={value ? `Categoría: ${value}` : "Seleccionar categoría"}
      aria-expanded={open} onClick={() => setOpen(true)}>
      {value || "Seleccionar"} <ChevronDown size={17} aria-hidden="true" />
    </button>
    {open && createPortal(<dialog className="hf-dialog hf-category-panel" aria-labelledby={id}
      ref={(node) => { if (node && !node.open) node.showModal(); }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!saving) close();
      }}>
      <div className="hf-summary-head"><h2 id={id}>Categorías</h2>
        <div className="hf-actions">
          <button type="button" disabled={saving} onClick={() => edit("create")}>Crear categoría</button>
          <button type="button" onClick={close} disabled={saving}>Cerrar</button>
        </div>
      </div>
      {editing?.action === "create" && nameForm}
      {[...names].sort((a, b) => a.localeCompare(b, "es")).map((item) => editing?.action === "rename" && editing.selected === item
        ? <div className="hf-category-inline" key={item}>{nameForm}</div>
        : <div key={item} className="hf-category-row">
        <button type="button" aria-pressed={item === value} disabled={saving} onClick={() => {
          onChange(item);
          close();
        }}>{item}</button>
        <button type="button" aria-label={`Editar categoría ${item}`} disabled={saving} onClick={() => edit("rename", item)}>Editar</button>
        <button type="button" aria-label={`Eliminar categoría ${item}`} disabled={saving} onClick={() => edit("delete", item)}>Eliminar</button>
      </div>)}
      {editing?.action === "delete" && <div className="hf-category-edit">
        <p>¿Eliminar la categoría {editing.selected}? Los movimientos existentes conservarán su categoría.</p>
        <div className="hf-actions">
          <button type="button" disabled={saving} onClick={reset}>Cancelar</button>
          <button type="button" className="hf-primary" disabled={saving} onClick={save}>Confirmar eliminación</button>
        </div>
      </div>}
      {error && <p className="hf-notice" role="alert">{error}</p>}
    </dialog>, document.body)}
  </div>;
}
