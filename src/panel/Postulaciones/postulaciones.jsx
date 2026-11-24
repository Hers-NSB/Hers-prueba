import AdminRefresh from "../AdminRefresh";
import { useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  AlertTriangle,
  Download,
  Globe,
  Loader2,
  Mail,
  Trash2,
  User,
  X,
} from "lucide-react";
import { FaInstagram, FaTelegram, FaWhatsapp } from "react-icons/fa";
import { AdminError } from "../adminActions";
import AdminLoading from "../AdminLoading.jsx";
import "./postulaciones.css";
import {
  supabase,
  APPLICATIONS_TABLE,
  PHOTOS_BUCKET,
} from "../../lib/supabase";

const PHOTO_FIELDS = [
  { key: "foto_natural1_path", label: "Natural 1" },
  { key: "foto_natural2_path", label: "Natural 2" },
  { key: "foto_natural3_path", label: "Natural 3" },
  { key: "foto_lenceria1_path", label: "Lencería 1" },
  { key: "foto_lenceria2_path", label: "Lencería 2" },
  { key: "foto_lenceria3_path", label: "Lencería 3" },
];

const PAGE_SIZE = 24;

async function signPhotos(app) {
  const paths = [...new Set(PHOTO_FIELDS.map(({ key }) => app[key]).filter(Boolean))];
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  return Object.fromEntries(data.filter((photo) => !photo.error && photo.signedUrl)
    .map((photo) => [photo.path, photo.signedUrl]));
}

export default function Postulaciones({ revision = 0 }) {
  const [applications, setApplications] = useState([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [completed, setCompleted] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirmApp, setConfirmApp] = useState(null);
  const requestKey = `${revision}:${page}:${reload}`;
  const loading = completed !== requestKey;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const offset = page * PAGE_SIZE;
        const { data, count, error } = await supabase.from(APPLICATIONS_TABLE)
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw error;
        setError("");
        setTotal(count ?? 0);
        setApplications(data ?? []);
        const lastPage = Math.max(0, Math.ceil((count ?? 0) / PAGE_SIZE) - 1);
        if (page > lastPage) setPage(lastPage);
      } catch (error) {
        if (!controller.signal.aborted) setError("No se pudieron cargar las postulaciones: " + error.message);
      } finally {
        if (!controller.signal.aborted) setCompleted(requestKey);
      }
    }
    void load();
    return () => controller.abort();
  }, [page, requestKey]);

  const requestDelete = (app) => setConfirmApp(app);

  const handleDelete = async (app) => {
    setConfirmApp(null);
    setBusyId(app.id);
    setError("");

    try {
      const paths = PHOTO_FIELDS.map(({ key }) => app[key]).filter(Boolean);

      if (paths.length) {
        const { error: storageError } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .remove(paths);
        if (storageError)
          throw new Error("Error borrando las fotos: " + storageError.message);
      }

      const { error: deleteError } = await supabase
        .from(APPLICATIONS_TABLE)
        .delete()
        .eq("id", app.id);

      if (deleteError)
        throw new Error(
          "Error borrando la postulación: " + deleteError.message,
        );

      setReload((value) => value + 1);
      if (selected?.id === app.id) setSelected(null);
    } catch (deleteError) {
      setError(deleteError?.message || "Error borrando la postulación");
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (app) => {
    setBusyId(app.id);
    setError("");

    try {
      const photoUrls = await signPhotos(app);
      const missing = PHOTO_FIELDS.filter(({ key }) => !photoUrls?.[app[key]]).map(({ label }) => label);
      if (missing.length) throw new Error(`Faltan fotos: ${missing.join(", ")}`);
      const zip = new JSZip();

      const infoLines = [
        `Nombre: ${app.nombre}`,
        `Edad: ${app.edad}`,
        `País: ${app.pais}`,
        `Correo: ${app.email}`,
        `Instagram: ${app.instagram || "-"}`,
        `WhatsApp: ${app.whatsapp || "-"}`,
        `Telegram: ${app.telegram || "-"}`,
        `Fecha de postulación: ${new Date(app.created_at).toLocaleString()}`,
        "",
        `Límites: ${app.limites || "-"}`,
        `Estilo de contenido: ${app.estilo_contenido || "-"}`,
        `Convivencia: ${app.convivencia || "-"}`,
        `Tiene pareja: ${app.tiene_pareja || "-"}`,
        `Problema con pareja: ${app.problema_pareja || "-"}`,
        `Resultados y limitantes: ${app.resultados_limitantes || "-"}`,
        `Expectativas y aporte: ${app.expectativas_aporte || "-"}`,
        `Preferencias y fetiches: ${app.preferencias_fetiches || "-"}`,
      ];
      zip.file("postulacion.txt", infoLines.join("\n"));

      for (const { key, label } of PHOTO_FIELDS) {
        const path = app[key];
        const response = await fetch(photoUrls[path]);
        if (!response.ok) throw new Error(`No se pudo descargar ${label}`);

        const blob = await response.blob();
        const ext = path.split(".").pop() || "jpg";
        zip.file(`${label.replace(/\s+/g, "_")}.${ext}`, blob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(
        content,
        `postulacion_${(app.nombre || "sin_nombre").replace(/\s+/g, "_")}.zip`,
      );
    } catch (err) {
      setError("Error al descargar: " + err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="postulaciones-module">
      <div className="postulaciones-panel">
        <header className="postulaciones-header">
          <h2>Panel de postulaciones <AdminRefresh busy={revision > 0 && loading} section="Postulaciones" /></h2>
        </header>

        <AdminError id="applications" section="Postulaciones" message={error} />

        {loading ? (
          <AdminLoading>Cargando Postulaciones…</AdminLoading>
        ) : applications.length === 0 ? (
          <p className="postulaciones-empty">Todavía no hay postulaciones</p>
        ) : (
          <div className="postulaciones-grid">
            {applications.map((app) => (
              <article className="postulaciones-card" key={app.id}>
                <div className="postulaciones-card__body">
                  <h3>{app.nombre}</h3>
                  <p className="postulaciones-card__meta">
                    {app.edad} años · {app.pais}
                  </p>
                  <p className="postulaciones-card__meta">{app.email}</p>
                  <p className="postulaciones-card__date">
                    {app.created_at
                      ? new Date(app.created_at).toLocaleDateString()
                      : "—"}
                  </p>
                </div>

                <div className="postulaciones-card__actions">
                  <button
                    className="postulaciones-btn postulaciones-btn--outline"
                    onClick={() => setSelected(app)}
                  >
                    Ver detalle
                  </button>
                  <button
                    className="postulaciones-btn postulaciones-btn--outline"
                    disabled={busyId === app.id}
                    onClick={() => handleDownload(app)}
                    aria-label="Descargar"
                  >
                    {busyId === app.id ? (
                      <Loader2 size={15} className="postulaciones-spin" />
                    ) : (
                      <Download size={15} />
                    )}
                  </button>
                  <button
                    className="postulaciones-btn postulaciones-btn--outline postulaciones-card__delete"
                    disabled={busyId === app.id}
                    onClick={() => requestDelete(app)}
                    aria-label="Borrar"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {pageCount > 1 && <nav className="postulaciones-form-row-buttons" aria-label="Páginas de postulaciones">
          <button className="postulaciones-btn postulaciones-btn--outline" type="button"
            disabled={loading || page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page + 1} de {pageCount}</span>
          <button className="postulaciones-btn postulaciones-btn--outline" type="button"
            disabled={loading || page + 1 >= pageCount} onClick={() => setPage(page + 1)}>Siguiente</button>
        </nav>}

        {selected && (
          <ApplicationDetail
            app={selected}
            key={selected.id}
            onClose={() => setSelected(null)}
            onDelete={() => requestDelete(selected)}
            onDownload={() => handleDownload(selected)}
            busy={busyId === selected.id}
          />
        )}

        {confirmApp && (
          <ConfirmDialog
            title="Eliminar postulación"
            message={`Seguro que quieres eliminar la postulación de ${confirmApp.nombre}?`}
            confirmLabel="Eliminar"
            cancelLabel="Cancelar"
            busy={busyId === confirmApp.id}
            onCancel={() => setConfirmApp(null)}
            onConfirm={() => handleDelete(confirmApp)}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy,
  onCancel,
  onConfirm,
}) {
  return (
    <div
      className="postulaciones-modal-overlay postulaciones-confirm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="postulaciones-modal-card postulaciones-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="postulaciones-confirm-dialog-title"
      >
        <div className="postulaciones-confirm-dialog__icon">
          <AlertTriangle size={22} />
        </div>
        <h3 id="postulaciones-confirm-dialog-title">{title}</h3>
        <p>{message}</p>
        <div className="postulaciones-form-row-buttons">
          <button
            className="postulaciones-btn postulaciones-btn--outline"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            className="postulaciones-btn postulaciones-btn--primary postulaciones-confirm-dialog__confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={16} className="postulaciones-spin" />
            ) : (
              <Trash2 size={16} />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApplicationDetail({
  app,
  onClose,
  onDelete,
  onDownload,
  busy,
}) {
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [photoUrls, setPhotoUrls] = useState(null);
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    let active = true;
    signPhotos(app).then((urls) => {
      if (!active) return;
      setPhotoUrls(urls);
      if (PHOTO_FIELDS.some(({ key }) => !urls[app[key]])) setPhotoError("Faltan fotos en esta postulación.");
    }).catch(() => { if (active) setPhotoError("No se pudieron cargar las fotografías."); });
    return () => { active = false; };
  }, [app]);


  const availablePhotos = useMemo(() => PHOTO_FIELDS.filter(
    ({ key }) => app[key] && photoUrls?.[app[key]],
  ).map(({ key, label }) => ({
    key,
    label,
    url: photoUrls?.[app[key]],
  })), [app, photoUrls]);

  const expandedPhotoIndex = expandedPhoto
    ? availablePhotos.findIndex((photo) => photo.key === expandedPhoto.key)
    : -1;

  const showPhoto = useCallback((index) => {
    if (!availablePhotos.length) return;
    const normalizedIndex =
      (index + availablePhotos.length) % availablePhotos.length;
    setExpandedPhoto(availablePhotos[normalizedIndex]);
  }, [availablePhotos]);

  useEffect(() => {
    if (!expandedPhoto) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setExpandedPhoto(null);
      } else if (event.key === "ArrowRight") {
        showPhoto(expandedPhotoIndex + 1);
      } else if (event.key === "ArrowLeft") {
        showPhoto(expandedPhotoIndex - 1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedPhoto, expandedPhotoIndex, showPhoto]);

  return (
    <div
      className="postulaciones-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="postulaciones-modal-card postulaciones-modal-card--wide postulaciones-detail">
        <button
          className="postulaciones-modal-close"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>

        <h2>{app.nombre}</h2>
        <p className="postulaciones-modal-subtitle">
          Postulación del {new Date(app.created_at).toLocaleString()}
        </p>

        {photoError ? <p role="alert">{photoError}</p> : !photoUrls && <p role="status">Cargando fotos…</p>}
        <div className="postulaciones-detail__photos">
          {PHOTO_FIELDS.map(({ key, label }) =>
            app[key] && photoUrls?.[app[key]] ? (
              <figure
                key={key}
                className="postulaciones-detail__photo"
                onClick={() =>
                  setExpandedPhoto({
                    key,
                    url: photoUrls?.[app[key]],
                    label,
                  })
                }
              >
                <img src={photoUrls?.[app[key]]} alt={label} />
                <figcaption>{label}</figcaption>
              </figure>
            ) : null,
          )}
        </div>

        <dl className="postulaciones-detail__list">
          <dt>
            <User size={14} /> Edad
          </dt>
          <dd>{app.edad}</dd>
          <dt>
            <Globe size={14} /> País
          </dt>
          <dd>{app.pais}</dd>
          <dt>
            <Mail size={14} /> Correo
          </dt>
          <dd>{app.email}</dd>
          <dt>
            <FaInstagram size={14} /> Instagram
          </dt>
          <dd>{app.instagram || "-"}</dd>
          <dt>
            <FaWhatsapp size={14} /> WhatsApp
          </dt>
          <dd>{app.whatsapp || "-"}</dd>
          <dt>
            <FaTelegram size={14} /> Telegram
          </dt>
          <dd>{app.telegram || "-"}</dd>
        </dl>

        <div className="postulaciones-detail__answers">
          <p>
            <strong>Límites:</strong> {app.limites}
          </p>
          <p>
            <strong>Estilo de contenido:</strong> {app.estilo_contenido}
          </p>
          <p>
            <strong>Convivencia:</strong> {app.convivencia}
          </p>
          <p>
            <strong>Tiene pareja:</strong> {app.tiene_pareja}
          </p>
          <p>
            <strong>Problema con pareja:</strong> {app.problema_pareja}
          </p>
          <p>
            <strong>Resultados y limitantes:</strong>{" "}
            {app.resultados_limitantes}
          </p>
          <p>
            <strong>Expectativas y aporte:</strong> {app.expectativas_aporte}
          </p>
          <p>
            <strong>Preferencias y fetiches:</strong>{" "}
            {app.preferencias_fetiches}
          </p>
        </div>

        <div className="postulaciones-form-row-buttons">
          <button
            className="postulaciones-btn postulaciones-btn--outline"
            disabled={busy}
            onClick={onDownload}
          >
            {busy ? (
              <Loader2 size={16} className="postulaciones-spin" />
            ) : (
              <Download size={16} />
            )}
            Descargar todo
          </button>
          <button
            className="postulaciones-btn postulaciones-btn--primary"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 size={16} />
            Borrar postulación
          </button>
        </div>
      </div>

      {expandedPhoto && (
        <div
          className="postulaciones-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ampliada: ${expandedPhoto.label}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setExpandedPhoto(null);
          }}
        >
          <button
            className="postulaciones-photo-lightbox__close"
            onClick={() => setExpandedPhoto(null)}
            aria-label="Cerrar foto"
          >
            <X size={22} />
          </button>

          <button
            className="postulaciones-photo-lightbox__nav postulaciones-photo-lightbox__nav--prev"
            onClick={() => showPhoto(expandedPhotoIndex - 1)}
            aria-label="Foto anterior"
            disabled={availablePhotos.length < 2}
          >
            ‹
          </button>

          <div className="postulaciones-photo-lightbox__content">
            <img src={expandedPhoto.url} alt={expandedPhoto.label} />
            <p>
              {expandedPhoto.label} · {expandedPhotoIndex + 1} de{" "}
              {availablePhotos.length}
            </p>
          </div>

          <button
            className="postulaciones-photo-lightbox__nav postulaciones-photo-lightbox__nav--next"
            onClick={() => showPhoto(expandedPhotoIndex + 1)}
            aria-label="Foto siguiente"
            disabled={availablePhotos.length < 2}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
