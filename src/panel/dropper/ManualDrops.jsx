import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AdminError, AdminNotice } from "../adminActions";
import { AdminInitialContent } from "../AdminLoading";
import dropperApi from "./dropperApi";

const bucket = "manual-drop-photos";
const newStep = () => ({ key: crypto.randomUUID(), send_time: "", text: "", photo: null, file: null });
const newChain = () => ({ id: crypto.randomUUID(), name: "", creator_id: "", enabled: true, revision: 0, steps: [newStep()] });

export default function ManualDrops({ revision }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      dropperApi("/manual-drops", "GET", undefined, controller.signal),
      dropperApi("/creators", "GET", undefined, controller.signal),
    ]).then(([schedule, choices]) => {
      if (controller.signal.aborted) return;
      setData({ ...schedule, creators: choices.creators });
      setError("");
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [revision, reload]);

  const change = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const changeStep = (key, fields) => setDraft((current) => ({
    ...current, steps: current.steps.map((step) => step.key === key ? { ...step, ...fields } : step),
  }));
  function move(position, offset) {
    const next = [...draft.steps];
    [next[position], next[position + offset]] = [next[position + offset], next[position]];
    change("steps", next);
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const [index, step] of draft.steps.entries()) {
        if (!step.text.trim() && !step.photo && !step.file) throw new Error(`Agrega texto o foto a la publicación ${index + 1}`);
        if (index > 0 && step.send_time < draft.steps[index - 1].send_time) {
          throw new Error("Ordena las publicaciones de la hora más temprana a la más tarde");
        }
        if (step.file && (!["image/jpeg", "image/png"].includes(step.file.type) || step.file.size > 10_485_760)) {
          throw new Error(`La foto de la publicación ${index + 1} debe ser JPEG o PNG de hasta 10 MB`);
        }
      }
      const steps = [];
      for (const step of draft.steps) {
        let photo = step.photo;
        if (step.file) {
          const ext = step.file.type === "image/png" ? "png" : "jpg";
          photo = `${draft.id}/${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from(bucket).upload(photo, step.file);
          if (uploadError) throw uploadError;
          changeStep(step.key, { photo, file: null });
        }
        steps.push({ send_time: step.send_time, text: step.text, photo });
      }
      const { id, name, creator_id, enabled, revision: version } = draft;
      await dropperApi("/manual-drops", "PUT", { id, name, creator_id: Number(creator_id), enabled, revision: version, steps });
      setDraft(null);
      setReload((value) => value + 1);
      setNotice("Cadena de drops guardada");
    } catch (failure) {
      setError(failure.message || "No se pudo guardar la cadena");
    } finally {
      setBusy(false);
    }
  }

  const deliveryErrors = data?.deliveries.map(({ name, position, error }) =>
    `${name} · Publicación ${position}: ${error ?? "Envío sin confirmar. Revisa el feed."}`).join(" · ");
  return <AdminInitialContent loading={!data && !error} label="drops manuales">
  <section className="hf-section hers-manual-drops" aria-labelledby="hers-manual-drops-title">
    <AdminError id="manual-drops" section="Dropper" message={error} />
    <AdminError id="manual-deliveries" section="Dropper" message={deliveryErrors} />
    <AdminNotice id="manual-drops-saved" section="Dropper" message={notice} />
    <div className="hf-summary-head">
      <div><h2 id="hers-manual-drops-title">Drops manuales</h2><p>Envío diario · Hora de Caracas · Caducan después de 1 día</p></div>
      {data && !draft && <button type="button" className="hf-primary" onClick={() => setDraft(newChain())}>
        <Plus size={16} aria-hidden="true" /> Nueva cadena
      </button>}
    </div>
    {data && !draft && (data.chains.length ? <ul className="hers-manual-chains">{data.chains.map((chain) =>
      <li key={chain.id}>
        <div><strong>{chain.name}</strong><span>{chain.creator_name} · {chain.steps.length} publicaciones</span></div>
        <span>{chain.enabled ? `Diaria desde ${chain.start_date}` : "Pausada"}</span>
        <button type="button" onClick={() => setDraft({ ...chain, enabled: Boolean(chain.enabled),
          steps: chain.steps.map((step) => ({ ...step, key: crypto.randomUUID(), file: null })) })}>Editar</button>
      </li>
    )}</ul> : <p className="hf-empty">Sin cadenas configuradas</p>)}
    {draft && <form className="hers-manual-form" onSubmit={save}>
      <fieldset className="hf-form" disabled={busy}>
        <label>Nombre de la cadena<input value={draft.name} maxLength={120} required onChange={(e) => change("name", e.target.value)} /></label>
        <label>Modelo<select value={draft.creator_id} required onChange={(e) => change("creator_id", e.target.value)}>
          <option value="">Selecciona una modelo</option>
          {draft.creator_id && !data.creators.some(({ external_id }) => external_id === Number(draft.creator_id)) &&
            <option value={draft.creator_id} disabled>{draft.creator_name}</option>}
          {data.creators.map(({ external_id, name }) => <option key={external_id} value={external_id}>{name}</option>)}
        </select></label>
        <label className="hers-manual-check">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => change("enabled", e.target.checked)} /> Enviar todos los días
        </label>
      </fieldset>
      {draft.steps.map((step, index) => <fieldset key={step.key} className="hf-form hers-manual-step" disabled={busy}>
        <legend>Publicación {index + 1}</legend>
        <label>Hora<input type="time" required value={step.send_time} onChange={(e) => changeStep(step.key, { send_time: e.target.value })} /></label>
        <label>Foto<input type="file" accept="image/jpeg,image/png" disabled={!data.photos_configured}
          onChange={(e) => changeStep(step.key, { file: e.target.files[0] ?? null })} />
          {step.photo && <button type="button" onClick={() => changeStep(step.key, { photo: null, file: null })}>Quitar foto guardada</button>}
        </label>
        <label className="hf-full-field">Texto<textarea rows={3} maxLength={4000} value={step.text}
          onChange={(e) => changeStep(step.key, { text: e.target.value })} /></label>
        <div className="hf-actions hf-full-field">
          <button type="button" aria-label={`Subir publicación ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
          <button type="button" aria-label={`Bajar publicación ${index + 1}`} disabled={index + 1 === draft.steps.length} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
          <button type="button" aria-label={`Quitar publicación ${index + 1}`} disabled={draft.steps.length === 1}
            onClick={() => change("steps", draft.steps.filter(({ key }) => key !== step.key))}><X size={17} /></button>
        </div>
      </fieldset>)}
      {!data.photos_configured && <p>El almacenamiento de fotos aún no está conectado.</p>}
      <div className="hf-actions">
        <button type="button" disabled={busy || draft.steps.length >= 50} onClick={() => change("steps", [...draft.steps, newStep()])}>Agregar publicación</button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
        <button type="submit" className="hf-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar cadena"}</button>
      </div>
    </form>}
  </section>
  </AdminInitialContent>;
}
