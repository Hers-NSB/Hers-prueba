import { useId, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function CategoryPicker({ categories, value, onChange }) {
  const id = useId();
  const [names, setNames] = useState(() => categories.map(({ name }) => name));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setEditing(null); setError(""); };
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
    } catch (failure) {
      setError(failure.code === "23505" ? "Ya existe una categoría con ese nombre" : "No se pudo guardar el cambio");
    } finally {
      setSaving(false);
    }
  }

  return <div className="hf-category">
    <button type="button" className="hf-select-trigger" aria-expanded={open} aria-controls={id} onClick={() => {
      setOpen(!open);
      reset();
    }}>Categoría{value ? ` · ${value}` : ""}</button>
    {open && <div className="hf-category-panel" id={id} role="group" aria-label="Categorías">
      {[...names].sort((a, b) => a.localeCompare(b, "es")).map((item) => <div key={item} className="hf-category-row">
        <button type="button" aria-pressed={item === value} onClick={() => {
          onChange(item);
          setOpen(false);
          reset();
        }}>{item}</button>
        <button type="button" aria-label={`Editar categoría ${item}`} disabled={saving} onClick={() => edit("rename", item)}>Editar</button>
        <button type="button" aria-label={`Eliminar categoría ${item}`} disabled={saving} onClick={() => edit("delete", item)}>Eliminar</button>
      </div>)}
      {editing ? <div className="hf-category-edit">
        {editing.action === "delete"
          ? <p>¿Eliminar la categoría {editing.selected}? Los movimientos existentes conservarán su categoría.</p>
          : <label>{editing.action === "create" ? "Nueva categoría" : "Nombre de la categoría"}
            <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>}
        <div className="hf-actions">
          <button type="button" disabled={saving} onClick={reset}>Cancelar</button>
          <button type="button" className="hf-primary" disabled={saving || (editing.action !== "delete" && !name.trim())}
            onClick={save}>{editing.action === "delete" ? "Confirmar eliminación" : "Guardar categoría"}</button>
        </div>
      </div> : <button type="button" onClick={() => edit("create")}>Crear categoría</button>}
      {error && <p className="hf-notice" role="alert">{error}</p>}
    </div>}
  </div>;
}
