import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import "./historias.css";
import {
  FaFeather,
  FaBook,
  FaEdit,
  FaTrash,
  FaPlus,
  FaSignOutAlt,
  FaPaperclip,
  FaVideo,
  FaCamera,
  FaSave,
  FaTimes,
  FaStar,
  FaLink,
  FaBolt,
  FaTree,
  FaArrowUp,
  FaArrowDown,
  FaSpinner,
  FaFolderOpen,
  FaChevronDown,
  FaChevronRight,
  FaPlusCircle,
} from "react-icons/fa";

const BotonConCarga = ({
  onClick,
  cargando,
  texto,
  textoCargando = "Guardando...",
  icono,
  iconoCargando = <FaSpinner className="historias-spin" />,
  className = "",
  disabled = false,
  ...props
}) => (
  <button
    onClick={onClick}
    disabled={disabled || cargando}
    className={`historias-btn-con-carga ${cargando ? "historias-cargando" : ""} ${className}`}
    {...props}
  >
    {cargando ? (
      <>
        <span
          className="historias-btn-carga-indicador"
          aria-hidden="true"
        ></span>
        {iconoCargando}
        <span className="historias-btn-texto-carga">{textoCargando}</span>
      </>
    ) : (
      <>
        {icono}
        <span className="historias-btn-texto">{texto}</span>
      </>
    )}
  </button>
);

const ModalBloqueadoUnificado = ({
  isOpen,
  onSave,
  onCancel,
  setEsBloqueado,
  precioEstrellas,
  setPrecioEstrellas,
  titulo = "Configuración Bloqueado",
  subtitulo = "Ingresa el número de ⭐ (ponga 0 para desactivar)",
}) => {
  if (!isOpen) return null;

  return (
    <div className="historias-bloqueado-overlay">
      <div className="historias-bloqueado-modal">
        <div className="historias-bloqueado-modal-header">
          <h3>
            <FaStar /> {titulo}
          </h3>
        </div>
        <p>{subtitulo}</p>

        <div className="historias-bloqueado-config">
          <div className="historias-campo-bloqueado">
            <label>Precio ⭐:</label>
            <input
              type="number"
              min="0"
              max="100"
              value={precioEstrellas}
              onChange={(e) => {
                const valor = e.target.value;
                if (valor === "") {
                  setPrecioEstrellas("");
                  setEsBloqueado(false);
                  return;
                }
                const numero = Math.max(
                  0,
                  Math.min(100, parseInt(valor, 10) || 0),
                );
                setPrecioEstrellas(numero);
                setEsBloqueado(numero > 0);
              }}
              className="historias-input-precio"
              placeholder="Ej: 5 (0 para desactivar)"
              autoFocus
            />
            <small>
              {precioEstrellas > 0 ? ` ${precioEstrellas} ⭐` : "Desactivado"}
            </small>
          </div>
        </div>

        <div className="historias-bloqueado-actions">
          <button onClick={onSave} className="historias-btn-guardar-bloqueado">
            <FaSave /> Guardar
          </button>
          <button
            onClick={onCancel}
            className="historias-btn-cancelar-bloqueado"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

const SelectorMultimedia = ({
  videos,
  fotos,
  seleccionados,
  onToggle,
  mensajeIdIgnorar = null,
  verificarEnUso,
}) => {
  const MultimediaItem = ({ item, tipo }) => {
    const enUso = verificarEnUso
      ? verificarEnUso(item.file_unique_id, mensajeIdIgnorar)
      : false;
    const estaSeleccionado = seleccionados.some(
      (m) => m.file_unique_id === item.file_unique_id && m.tipo === tipo,
    );

    return (
      <div
        className={`historias-item-multimedia-small ${estaSeleccionado ? "historias-seleccionado" : ""} ${enUso && !estaSeleccionado ? "historias-en-uso" : ""}`}
        onClick={() => {
          if (enUso && !estaSeleccionado) {
            return;
          }
          onToggle(item, tipo);
        }}
      >
        {tipo === "video" ? <FaVideo /> : <FaCamera />}
        <span>
          {item.caption || tipo}
          {item.duracion_texto && (
            <span className="historias-multimedia-detalle">
              {" "}
              {item.duracion_texto}
            </span>
          )}
          {enUso && !estaSeleccionado && (
            <span className="historias-en-uso-badge">(En uso)</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="historias-selector-multimedia-small">
      {videos.length > 0 && (
        <>
          <h4>
            <FaVideo /> Videos:
          </h4>
          <div className="historias-grid-multimedia-small">
            {videos.map((video) => (
              <MultimediaItem key={video.id} item={video} tipo="video" />
            ))}
          </div>
        </>
      )}
      {fotos.length > 0 && (
        <>
          <h4>
            <FaCamera /> Fotos:
          </h4>
          <div className="historias-grid-multimedia-small">
            {fotos.map((foto) => (
              <MultimediaItem key={foto.id} item={foto} tipo="foto" />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const MensajeForm = ({
  mensajeEn,
  setMensajeEn,
  mensajeEs,
  setMensajeEs,
  multimediaSeleccionada,
  setMultimediaSeleccionada,
  onSubmit,
  cargando,
  videosDisponibles,
  fotosDisponibles,
  botonTexto = "Agregar",
  mensajeIdIgnorar = null,
  onToggleMultimedia,
  verificarEnUso,
  esBloqueado,
  precioEstrellas,
  onOpenBloqueado,
}) => {
  const [mostrarSelector, setMostrarSelector] = useState(false);

  return (
    <div className="historias-form-mensaje-normal">
      <div className="historias-form-mensaje-header">
        <h4 className="historias-form-mensaje-titulo">
          <FaFeather /> Agregar mensaje a la secuencia
        </h4>
        {multimediaSeleccionada.length > 0 && (
          <button
            type="button"
            onClick={onOpenBloqueado}
            className={`historias-btn-bloqueado-header ${esBloqueado ? "historias-activo" : ""}`}
            title="Configurar bloqueado para el mensaje"
          >
            <FaStar /> {esBloqueado ? ` ${precioEstrellas} ⭐` : "Bloqueado"}
          </button>
        )}
      </div>
      <form onSubmit={onSubmit} className="historias-form-mensaje-row">
        <div className="historias-bilingue-campos">
          <div className="historias-bilingue-campo">
            <label> English</label>
            <textarea
              placeholder="Message in English..."
              value={mensajeEn}
              onChange={(e) => setMensajeEn(e.target.value)}
              className="historias-input-mensaje-small"
              rows="2"
            />
          </div>
          <div className="historias-bilingue-campo">
            <label> Español</label>
            <textarea
              placeholder="Mensaje en español..."
              value={mensajeEs}
              onChange={(e) => setMensajeEs(e.target.value)}
              className="historias-input-mensaje-small"
              rows="2"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMostrarSelector(!mostrarSelector)}
          className="historias-btn-selector-multimedia-small"
        >
          <FaPaperclip />{" "}
          {multimediaSeleccionada.length > 0
            ? `${multimediaSeleccionada.length} archivo(s)`
            : "Contenido"}
        </button>
        {mostrarSelector && (
          <SelectorMultimedia
            videos={videosDisponibles}
            fotos={fotosDisponibles}
            seleccionados={multimediaSeleccionada}
            onToggle={(item, tipo) =>
              onToggleMultimedia(
                item,
                tipo,
                multimediaSeleccionada,
                setMultimediaSeleccionada,
                mensajeIdIgnorar,
              )
            }
            mensajeIdIgnorar={mensajeIdIgnorar}
            verificarEnUso={verificarEnUso}
          />
        )}
        <BotonConCarga
          onClick={onSubmit}
          cargando={cargando}
          texto={botonTexto}
          icono={<FaFeather />}
          iconoCargando={<FaSpinner className="historias-spin" />}
          className="historias-btn-agregar-mensaje-small"
          disabled={
            !mensajeEn.trim() &&
            !mensajeEs.trim() &&
            multimediaSeleccionada.length === 0
          }
        />
      </form>
    </div>
  );
};

function App({ embedded = true, onBack = null }) {
  const [historias, setHistorias] = useState([]);
  const [historiaActual, setHistoriaActual] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [secuencia, setSecuencia] = useState([]);
  const [tituloEn, setTituloEn] = useState("");
  const [tituloEs, setTituloEs] = useState("");
  const [mensajeEn, setMensajeEn] = useState("");
  const [mensajeEs, setMensajeEs] = useState("");
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const initialLoadDone = useRef(false);

  const [videosDisponibles, setVideosDisponibles] = useState([]);
  const [fotosDisponibles, setFotosDisponibles] = useState([]);
  const [multimediaSeleccionada, setMultimediaSeleccionada] = useState([]);
  const [mensajesMultimedia, setMensajesMultimedia] = useState({});
  const [estadisticasMensajes, setEstadisticasMensajes] = useState({});

  const [estadisticasCompras, setEstadisticasCompras] = useState({
    totalEstrellas: 0,
    usuarios: [],
  });

  const [mostrarFormularioOpcion, setMostrarFormularioOpcion] = useState(false);
  const [opcionesConfig, setOpcionesConfig] = useState([]);
  const [opcionEditando, setOpcionEditando] = useState(null);
  const [guardandoOpciones, setGuardandoOpciones] = useState(false);

  const [editandoMensaje, setEditandoMensaje] = useState(null);
  const [editMensajeEn, setEditMensajeEn] = useState("");
  const [editMensajeEs, setEditMensajeEs] = useState("");
  const [editMultimediaSeleccionada, setEditMultimediaSeleccionada] = useState(
    [],
  );
  const [mostrarEditorMultimedia, setMostrarEditorMultimedia] = useState(false);
  const [mostrarEditor, setMostrarEditor] = useState(false);
  const [cargandoEditor, setCargandoEditor] = useState(false);

  const [editandoHistoria, setEditandoHistoria] = useState(null);
  const [editTituloEn, setEditTituloEn] = useState("");
  const [editTituloEs, setEditTituloEs] = useState("");
  const [mostrarEditorHistoria, setMostrarEditorHistoria] = useState(false);
  const [guardandoHistoria, setGuardandoHistoria] = useState(false);

  const [confirmarEliminacion, setConfirmarEliminacion] = useState(null);

  const [opcionesExpandidas, setOpcionesExpandidas] = useState({});

  const [guardandoMensaje, setGuardandoMensaje] = useState(false);
  const [guardandoEdicionMensaje, setGuardandoEdicionMensaje] = useState(false);
  const [eliminandoItem, setEliminandoItem] = useState(false);
  const [moviendoItem, setMoviendoItem] = useState(false);
  const [itemIdEnMovimiento, setItemIdEnMovimiento] = useState(null);
  const [itemIdEnEliminacion, setItemIdEnEliminacion] = useState(null);

  const [mensajeCompleto, setMensajeCompleto] = useState(null);
  const [mostrarMensajeCompleto, setMostrarMensajeCompleto] = useState(false);
  const [cargandoMensajeCompleto, setCargandoMensajeCompleto] = useState(false);

  const [cargandoHistoria, setCargandoHistoria] = useState(false);

  const [formEsBloqueado, setFormEsBloqueado] = useState(false);
  const [formPrecioEstrellas, setFormPrecioEstrellas] = useState(0);

  const [opcionEsBloqueado, setOpcionEsBloqueado] = useState(false);
  const [opcionPrecioEstrellas, setOpcionPrecioEstrellas] = useState(0);
  const [opcionIndex, setOpcionIndex] = useState(null);
  const [opcionMensajeIndex, setOpcionMensajeIndex] = useState(null);

  const [completoEsBloqueado, setCompletoEsBloqueado] = useState(false);
  const [completoPrecioEstrellas, setCompletoPrecioEstrellas] = useState(0);
  const [completoMensajeId, setCompletoMensajeId] = useState(null);

  const [mostrarModalBloqueado, setMostrarModalBloqueado] = useState(false);
  const [modoBloqueado, setModoBloqueado] = useState("formulario");
  const bloqueadoOriginalRef = useRef({});

  const cargarHistorias = useCallback(async () => {
    const { data, error } = await supabase.from("historias").select("*");

    if (error) {
      console.error(" Error cargando historias:", error);
    } else {
      setHistorias(
        [...(data || [])].sort((a, b) =>
          (a.titulo_en || a.titulo_es || "").localeCompare(
            b.titulo_en || b.titulo_es || "",
            undefined,
            { sensitivity: "base" },
          ),
        ),
      );
    }
  }, []);

  const cargarMensajes = useCallback(async (historiaId) => {
    const { data, error } = await supabase
      .from("mensajes")
      .select("*")
      .eq("historia_id", historiaId)
      .order("id", { ascending: true });

    if (error) {
      console.error(" Error cargando mensajes:", error);
      return [];
    } else {
      setMensajes(data || []);
      return data || [];
    }
  }, []);

  const cargarSecuencia = useCallback(async (historiaId) => {
    const { data, error } = await supabase
      .from("secuencia")
      .select("*")
      .eq("historia_id", historiaId)
      .order("orden_visual", { ascending: true });

    if (error) {
      console.error(" Error cargando secuencia:", error);
      return [];
    } else {
      setSecuencia(data || []);
      return data || [];
    }
  }, []);

  const cargarMultimediaDisponible = useCallback(async () => {
    const { data: multimedia, error } = await supabase
      .from("multimedia")
      .select("*")
      .order("orden", { ascending: true });

    if (!error && multimedia) {
      setVideosDisponibles(multimedia.filter((m) => m.tipo === "video"));
      setFotosDisponibles(multimedia.filter((m) => m.tipo === "foto"));
    } else {
      console.error(" Error cargando multimedia disponible:", error);
    }
  }, []);

  const cargarEstadisticasComprasHistoria = useCallback(async (historiaId) => {
    if (!historiaId) {
      setEstadisticasCompras({ totalEstrellas: 0, usuarios: [] });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("compras_estrellas")
        .select("user_id, username, estrellas_pagadas, mensaje_id")
        .eq("historia_id", historiaId)
        .eq("historias-estado", "completado")
        .order("id", { ascending: true });

      if (error) throw error;

      const porUsuario = new Map();
      let totalEstrellas = 0;

      for (const compra of data || []) {
        const estrellas = Number(compra.estrellas_pagadas) || 0;
        totalEstrellas += estrellas;
        const key = String(compra.user_id);
        const actual = porUsuario.get(key) || {
          userId: compra.user_id,
          username: compra.username || `usuario_${compra.user_id}`,
          estrellas: 0,
          compras: 0,
        };
        actual.estrellas += estrellas;
        actual.compras += 1;
        if (compra.username) actual.username = compra.username;
        porUsuario.set(key, actual);
      }

      setEstadisticasCompras({
        totalEstrellas,
        usuarios: Array.from(porUsuario.values()).sort(
          (a, b) => b.estrellas - a.estrellas,
        ),
      });
    } catch (e) {
      console.error(" Error cargando estadísticas de estrellas:", e);
      setEstadisticasCompras({ totalEstrellas: 0, usuarios: [] });
    }
  }, []);

  const cargarMultimediaParaMensajes = useCallback(async (mensajesIds) => {
    if (!mensajesIds?.length) return;
    const nuevosCache = {};

    for (const id of mensajesIds) {
      try {
        const { data, error } = await supabase
          .from("multimedia")
          .select("*")
          .eq("mensaje_id", id)
          .order("orden", { ascending: true });
        if (!error && data) {
          nuevosCache[id] = data;
        }
      } catch (e) {
        console.error(`Error cargando multimedia para mensaje ${id}:`, e);
      }
    }

    setMensajesMultimedia((prev) => ({ ...prev, ...nuevosCache }));
  }, []);

  const cargarEstadisticasParaMensajes = useCallback(async (mensajesIds) => {
    if (!mensajesIds?.length) return;
    const nuevosCache = {};

    for (const id of mensajesIds) {
      try {
        const { error: mensajeError } = await supabase
          .from("mensajes")
          .select("*")
          .eq("id", id)
          .single();
        if (mensajeError) continue;

        const { data: multimediaData, error: multiError } = await supabase
          .from("multimedia")
          .select("*")
          .eq("mensaje_id", id);
        if (multiError) continue;

        nuevosCache[id] = {
          cantidadMultimedia: multimediaData?.length || 0,
          multimedia: multimediaData || [],
        };
      } catch (e) {
        console.error(`Error procesando estadísticas para mensaje ${id}:`, e);
      }
    }

    setEstadisticasMensajes((prev) => ({ ...prev, ...nuevosCache }));
  }, []);

  const cargarMultimediaDeMensaje = useCallback(async (mensajeId) => {
    try {
      const { data, error } = await supabase
        .from("multimedia")
        .select("*")
        .eq("mensaje_id", mensajeId)
        .order("orden", { ascending: true });

      if (error) {
        console.error(
          ` Error cargando multimedia del mensaje ${mensajeId}:`,
          error,
        );
        return [];
      }
      return data || [];
    } catch (e) {
      console.error(` Error en cargarMultimediaDeMensaje:`, e);
      return [];
    }
  }, []);

  const verificarMultimediaEnUso = useCallback(
    (fileUniqueId, mensajeIdIgnorar = null) => {
      if (!fileUniqueId) return false;
      for (const msgId in mensajesMultimedia) {
        if (msgId === mensajeIdIgnorar) continue;
        if (
          mensajesMultimedia[msgId]?.some(
            (m) => m.file_unique_id === fileUniqueId,
          )
        ) {
          return true;
        }
      }
      return false;
    },
    [mensajesMultimedia],
  );

  const recargarTodo = useCallback(
    async (historiaId, mensajesIds = null) => {
      setCargandoHistoria(true);
      try {
        await cargarMensajes(historiaId);
        const secuenciaCargada = await cargarSecuencia(historiaId);

        let idsMensajes = mensajesIds;
        if (!idsMensajes?.length) {
          idsMensajes = secuenciaCargada
            .filter((s) => s.tipo === "mensaje" && s.mensaje_id)
            .map((s) => s.mensaje_id);
          const hijosIds = secuenciaCargada
            .filter((s) => s.padre_id && s.mensaje_id)
            .map((s) => s.mensaje_id);
          idsMensajes = [...new Set([...idsMensajes, ...hijosIds])];
        }

        if (idsMensajes?.length) {
          await Promise.all([
            cargarMultimediaParaMensajes(idsMensajes),
            cargarEstadisticasParaMensajes(idsMensajes),
            cargarEstadisticasComprasHistoria(historiaId),
          ]);
        } else {
          await cargarEstadisticasComprasHistoria(historiaId);
        }
      } catch (e) {
        console.error(" Error en recargarTodo:", e);
      } finally {
        setCargandoHistoria(false);
      }
    },
    [
      cargarMensajes,
      cargarSecuencia,
      cargarMultimediaParaMensajes,
      cargarEstadisticasParaMensajes,
      cargarEstadisticasComprasHistoria,
    ],
  );

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      cargarHistorias();
      cargarMultimediaDisponible();
    }
  }, [cargarHistorias, cargarMultimediaDisponible]);

  const crearHistoria = useCallback(
    async (e) => {
      e.preventDefault();
      if (!tituloEn.trim() && !tituloEs.trim()) return;

      const { data, error } = await supabase
        .from("historias")
        .insert([
          {
            titulo_en: tituloEn.trim() || tituloEs.trim(),
            titulo_es: tituloEs.trim() || tituloEn.trim(),
          },
        ])
        .select();

      if (error) {
        console.error(" Error creando historia:", error);
      } else {
        setTituloEn("");
        setTituloEs("");
        setMostrarFormulario(false);
        await cargarHistorias();
        setHistoriaActual(data[0]);
        setMensajes([]);
        setSecuencia([]);
        setMensajesMultimedia({});
        setEstadisticasMensajes({});
        setEstadisticasCompras({ totalEstrellas: 0, usuarios: [] });
      }
    },
    [tituloEn, tituloEs, cargarHistorias],
  );

  const seleccionarHistoria = useCallback(
    async (historia) => {
      setHistoriaActual(historia);
      setMensajesMultimedia({});
      setEstadisticasMensajes({});
      setEstadisticasCompras({ totalEstrellas: 0, usuarios: [] });
      await recargarTodo(historia.id);
      setMostrarFormularioOpcion(false);
      setOpcionesConfig([]);
      setOpcionesExpandidas({});
    },
    [recargarTodo],
  );

  const eliminarHistoria = useCallback(
    async (historiaId) => {
      setEliminandoItem(true);
      setItemIdEnEliminacion(historiaId);

      const { data: mensajesData } = await supabase
        .from("mensajes")
        .select("id")
        .eq("historia_id", historiaId);

      if (mensajesData) {
        for (const msg of mensajesData) {
          await supabase
            .from("multimedia")
            .update({ mensaje_id: null })
            .eq("mensaje_id", msg.id);
        }
      }

      await supabase.from("secuencia").delete().eq("historia_id", historiaId);
      await supabase.from("mensajes").delete().eq("historia_id", historiaId);
      await supabase.from("historias").delete().eq("id", historiaId);

      if (historiaActual?.id === historiaId) {
        setHistoriaActual(null);
        setMensajes([]);
        setSecuencia([]);
        setMensajesMultimedia({});
        setEstadisticasMensajes({});
      }
      await cargarHistorias();
      setConfirmarEliminacion(null);
      setEliminandoItem(false);
      setItemIdEnEliminacion(null);
    },
    [historiaActual, cargarHistorias],
  );

  const eliminarMensajeIndividual = useCallback(
    async (mensajeId, secuenciaId) => {
      setEliminandoItem(true);
      setItemIdEnEliminacion(secuenciaId);

      try {
        await supabase
          .from("multimedia")
          .update({ mensaje_id: null })
          .eq("mensaje_id", mensajeId);
        await Promise.all([
          supabase.from("secuencia").delete().eq("id", secuenciaId),
          supabase.from("mensajes").delete().eq("id", mensajeId),
        ]);

        const nuevosItems = secuencia
          .filter((item) => item.id !== secuenciaId)
          .map((item, index) => ({ ...item, orden_visual: index }));
        setSecuencia(nuevosItems);

        for (const update of nuevosItems) {
          await supabase
            .from("secuencia")
            .update({ orden_visual: update.orden_visual })
            .eq("id", update.id);
        }
        await recargarTodo(historiaActual.id);
      } catch (e) {
        console.error(" Error eliminando mensaje:", e);
      } finally {
        setEliminandoItem(false);
        setItemIdEnEliminacion(null);
        setConfirmarEliminacion(null);
      }
    },
    [secuencia, historiaActual, recargarTodo],
  );

  const eliminarOpcionCompleta = useCallback(
    async (opcionId) => {
      setEliminandoItem(true);
      setItemIdEnEliminacion(opcionId);

      const hijos = secuencia.filter((s) => s.padre_id === opcionId);

      for (const hijo of hijos) {
        if (hijo.mensaje_id) {
          await supabase
            .from("multimedia")
            .update({ mensaje_id: null })
            .eq("mensaje_id", hijo.mensaje_id);
          await supabase.from("mensajes").delete().eq("id", hijo.mensaje_id);
        }
        await supabase.from("secuencia").delete().eq("id", hijo.id);
      }

      const opcion = secuencia.find((s) => s.id === opcionId);
      if (opcion?.mensaje_id) {
        await supabase
          .from("multimedia")
          .update({ mensaje_id: null })
          .eq("mensaje_id", opcion.mensaje_id);
        await supabase.from("mensajes").delete().eq("id", opcion.mensaje_id);
      }
      await supabase.from("secuencia").delete().eq("id", opcionId);

      const nuevosItems = secuencia
        .filter(
          (item) =>
            item.id !== opcionId && !hijos.some((h) => h.id === item.id),
        )
        .map((item, index) => ({ ...item, orden_visual: index }));

      setSecuencia(nuevosItems);
      for (const item of nuevosItems) {
        await supabase
          .from("secuencia")
          .update({ orden_visual: item.orden_visual })
          .eq("id", item.id);
      }
      await recargarTodo(historiaActual.id);
      setConfirmarEliminacion(null);
      setEliminandoItem(false);
      setItemIdEnEliminacion(null);
    },
    [secuencia, historiaActual, recargarTodo],
  );

  const moverMensaje = useCallback(
    async (secuenciaId, direccion) => {
      setMoviendoItem(true);
      setItemIdEnMovimiento(secuenciaId);

      const indexActual = secuencia.findIndex(
        (item) => item.id === secuenciaId,
      );
      if (indexActual === -1) {
        setMoviendoItem(false);
        setItemIdEnMovimiento(null);
        return;
      }

      const nuevoIndex =
        direccion === "arriba" ? indexActual - 1 : indexActual + 1;
      if (nuevoIndex < 0 || nuevoIndex >= secuencia.length) {
        setMoviendoItem(false);
        setItemIdEnMovimiento(null);
        return;
      }

      const items = Array.from(secuencia);
      const [reorderedItem] = items.splice(indexActual, 1);
      items.splice(nuevoIndex, 0, reorderedItem);

      const nuevosItems = items.map((item, index) => ({
        ...item,
        orden_visual: index,
      }));
      setSecuencia(nuevosItems);

      for (const item of nuevosItems) {
        await supabase
          .from("secuencia")
          .update({ orden_visual: item.orden_visual })
          .eq("id", item.id);
      }

      setMoviendoItem(false);
      setItemIdEnMovimiento(null);
    },
    [secuencia],
  );

  const moverMensajeOpcion = useCallback(
    async (opcionId, secuenciaId, direccion) => {
      setMoviendoItem(true);
      setItemIdEnMovimiento(secuenciaId);

      try {
        const hijos = secuencia
          .filter((item) => item.padre_id === opcionId)
          .sort((a, b) => (a.orden_visual || 0) - (b.orden_visual || 0));

        const indiceActual = hijos.findIndex((item) => item.id === secuenciaId);
        if (indiceActual === -1) return;

        const nuevoIndice =
          direccion === "arriba" ? indiceActual - 1 : indiceActual + 1;
        if (nuevoIndice < 0 || nuevoIndice >= hijos.length) return;

        const actual = hijos[indiceActual];
        const destino = hijos[nuevoIndice];
        const ordenActual = actual.orden_visual;
        const ordenDestino = destino.orden_visual;

        await Promise.all([
          supabase
            .from("secuencia")
            .update({ orden_visual: ordenDestino })
            .eq("id", actual.id),
          supabase
            .from("secuencia")
            .update({ orden_visual: ordenActual })
            .eq("id", destino.id),
        ]);

        setSecuencia((prev) =>
          prev
            .map((item) => {
              if (item.id === actual.id) {
                return { ...item, orden_visual: ordenDestino };
              }
              if (item.id === destino.id) {
                return { ...item, orden_visual: ordenActual };
              }
              return item;
            })
            .sort((a, b) => (a.orden_visual || 0) - (b.orden_visual || 0)),
        );
      } catch (e) {
        console.error(" Error moviendo mensaje dentro de opción:", e);
      } finally {
        setMoviendoItem(false);
        setItemIdEnMovimiento(null);
      }
    },
    [secuencia],
  );


  const abrirBloqueadoFormulario = useCallback(() => {
    bloqueadoOriginalRef.current = {
      esBloqueado: formEsBloqueado,
      precioEstrellas: formPrecioEstrellas,
    };
    setModoBloqueado("formulario");
    setMostrarModalBloqueado(true);
  }, [formEsBloqueado, formPrecioEstrellas]);

  const abrirBloqueadoCompleto = useCallback((mensaje) => {
    bloqueadoOriginalRef.current = {
      esBloqueado: mensaje?.bloqueado || false,
      precioEstrellas: mensaje?.precio_estrellas || 0,
    };
    setModoBloqueado("completo");
    setCompletoEsBloqueado(mensaje?.bloqueado || false);
    setCompletoPrecioEstrellas(mensaje?.precio_estrellas || 0);
    setCompletoMensajeId(mensaje?.id || null);
    setMostrarModalBloqueado(true);
  }, []);

  const abrirBloqueadoOpcionTemp = useCallback(
    (index) => {
      const mensajeTemp = opcionesConfig[index]?.mensajeTemp;
      if (!mensajeTemp || mensajeTemp.multimedia?.length === 0) return;

      bloqueadoOriginalRef.current = {
        esBloqueado: mensajeTemp.esBloqueado || false,
        precioEstrellas: mensajeTemp.precioEstrellas || 0,
      };

      setModoBloqueado("opcionTemp");
      setOpcionEsBloqueado(mensajeTemp.esBloqueado || false);
      setOpcionPrecioEstrellas(mensajeTemp.precioEstrellas || 0);
      setOpcionIndex(index);
      setOpcionMensajeIndex(null);
      setMostrarModalBloqueado(true);
    },
    [opcionesConfig],
  );

  const abrirBloqueadoOpcion = useCallback((index, mensajeIndex, mensaje) => {
    if (!mensaje?.multimedia?.length) return;
    bloqueadoOriginalRef.current = {
      esBloqueado: mensaje?.bloqueado || false,
      precioEstrellas: mensaje?.precio_estrellas || 0,
    };
    setModoBloqueado("opcion");
    setOpcionEsBloqueado(mensaje?.bloqueado || false);
    setOpcionPrecioEstrellas(mensaje?.precio_estrellas || 0);
    setOpcionIndex(index);
    setOpcionMensajeIndex(mensajeIndex);
    setMostrarModalBloqueado(true);
  }, []);


  const guardarBloqueadoFormulario = useCallback(() => {
    setMostrarModalBloqueado(false);
    bloqueadoOriginalRef.current = {};
  }, []);

  const guardarBloqueadoCompleto = useCallback(async () => {
    if (!completoMensajeId) return;
    try {
      const { error } = await supabase
        .from("mensajes")
        .update({
          bloqueado: completoEsBloqueado,
          precio_estrellas: Number(completoPrecioEstrellas) || 0,
        })
        .eq("id", completoMensajeId);

      if (error) throw error;
      await recargarTodo(historiaActual.id);
      setMostrarModalBloqueado(false);
      setCompletoMensajeId(null);
      bloqueadoOriginalRef.current = {};
    } catch (e) {
      console.error("Error guardando bloqueado completo:", e);
    }
  }, [
    completoEsBloqueado,
    completoPrecioEstrellas,
    completoMensajeId,
    historiaActual,
    recargarTodo,
  ]);

  const guardarBloqueadoOpcionTemp = useCallback(() => {
    if (opcionIndex === null) return;

    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      const mensajeTemp = nuevos[opcionIndex]?.mensajeTemp;
      if (mensajeTemp) {
        const tieneMultimedia = mensajeTemp.multimedia?.length > 0;
        mensajeTemp.esBloqueado = tieneMultimedia && opcionEsBloqueado;
        mensajeTemp.precioEstrellas = tieneMultimedia
          ? Number(opcionPrecioEstrellas) || 0
          : 0;
      }
      return nuevos;
    });

    setMostrarModalBloqueado(false);
    setOpcionIndex(null);
    setOpcionMensajeIndex(null);
    bloqueadoOriginalRef.current = {};
  }, [opcionEsBloqueado, opcionPrecioEstrellas, opcionIndex]);

  const guardarBloqueadoOpcion = useCallback(() => {
    if (opcionIndex === null || opcionMensajeIndex === null) return;

    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      const mensaje = nuevos[opcionIndex].mensajes[opcionMensajeIndex];
      if (mensaje) {
        const tieneMultimedia = mensaje.multimedia?.length > 0;
        mensaje.bloqueado = tieneMultimedia && opcionEsBloqueado;
        mensaje.precio_estrellas = tieneMultimedia
          ? Number(opcionPrecioEstrellas) || 0
          : 0;
      }
      return nuevos;
    });

    setMostrarModalBloqueado(false);
    setOpcionIndex(null);
    setOpcionMensajeIndex(null);
    bloqueadoOriginalRef.current = {};
  }, [
    opcionEsBloqueado,
    opcionPrecioEstrellas,
    opcionIndex,
    opcionMensajeIndex,
  ]);

  const cancelarBloqueado = useCallback(() => {
    const original = bloqueadoOriginalRef.current || {};

    if (modoBloqueado === "formulario") {
      setFormEsBloqueado(original.esBloqueado || false);
      setFormPrecioEstrellas(original.precioEstrellas || 0);
    } else if (modoBloqueado === "completo") {
      setCompletoEsBloqueado(original.esBloqueado || false);
      setCompletoPrecioEstrellas(original.precioEstrellas || 0);
      setCompletoMensajeId(null);
    } else if (modoBloqueado === "opcionTemp" || modoBloqueado === "opcion") {
      setOpcionEsBloqueado(original.esBloqueado || false);
      setOpcionPrecioEstrellas(original.precioEstrellas || 0);
    }

    setMostrarModalBloqueado(false);
    setOpcionIndex(null);
    setOpcionMensajeIndex(null);
    bloqueadoOriginalRef.current = {};
  }, [modoBloqueado]);

  const guardarMensaje = useCallback(async () => {
    if (!historiaActual) return;

    if (mensajeEn.trim() || mensajeEs.trim()) {
      const mensajesExistentes = mensajes.filter(
        (m) => !m.mensaje_en?.startsWith("[OPCION]"),
      );
      for (const msg of mensajesExistentes) {
        if (
          (mensajeEn.trim() &&
            (msg.mensaje_en || "").trim() === mensajeEn.trim()) ||
          (mensajeEs.trim() &&
            (msg.mensaje_es || "").trim() === mensajeEs.trim())
        ) {
          const enSecuencia = secuencia.some(
            (s) => s.mensaje_id === msg.id && s.tipo === "mensaje",
          );
          if (enSecuencia) {
            return;
          }
        }
      }
    }

    for (const item of multimediaSeleccionada) {
      if (verificarMultimediaEnUso(item.file_unique_id)) {
        return;
      }
    }

    setGuardandoMensaje(true);
    try {
      const mensajeEnFinal = mensajeEn.trim() || mensajeEs.trim() || "";
      const mensajeEsFinal = mensajeEs.trim() || mensajeEn.trim() || "";
      const { data, error } = await supabase
        .from("mensajes")
        .insert([
          {
            historia_id: historiaActual.id,
            mensaje_en: mensajeEnFinal,
            mensaje_es: mensajeEsFinal,
            tiene_multimedia: multimediaSeleccionada.length > 0,
            bloqueado: multimediaSeleccionada.length > 0 && formEsBloqueado,
            precio_estrellas:
              multimediaSeleccionada.length > 0
                ? Number(formPrecioEstrellas) || 0
                : 0,
          },
        ])
        .select();

      if (error) throw error;
      const mensajeId = data[0].id;

      if (multimediaSeleccionada.length > 0) {
        for (const item of multimediaSeleccionada) {
          const { data: existingMedia } = await supabase
            .from("multimedia")
            .select("id")
            .eq("file_unique_id", item.file_unique_id)
            .maybeSingle();

          if (existingMedia) {
            await supabase
              .from("multimedia")
              .update({
                mensaje_id: mensajeId,
                orden: multimediaSeleccionada.indexOf(item),
              })
              .eq("id", existingMedia.id);
          } else {
            await supabase.from("multimedia").insert({
              mensaje_id: mensajeId,
              tipo: item.tipo,
              file_id: item.file_id,
              file_unique_id: item.file_unique_id,
              caption: item.caption || "",
              duracion_texto: item.duracion_texto || "",
              orden: multimediaSeleccionada.indexOf(item),
            });
          }
        }
      }

      const ordenActual = secuencia.length;
      await supabase.from("secuencia").insert({
        historia_id: historiaActual.id,
        tipo: "mensaje",
        mensaje_id: mensajeId,
        orden_visual: ordenActual,
      });

      setMensajeEn("");
      setMensajeEs("");
      setMultimediaSeleccionada([]);
      setFormEsBloqueado(false);
      setFormPrecioEstrellas(0);
      await recargarTodo(historiaActual.id, [mensajeId]);
    } catch (e) {
      console.error(" Error en guardarMensaje:", e);
    } finally {
      setGuardandoMensaje(false);
    }
  }, [
    historiaActual,
    mensajeEn,
    mensajeEs,
    multimediaSeleccionada,
    mensajes,
    secuencia,
    verificarMultimediaEnUso,
    recargarTodo,
    formEsBloqueado,
    formPrecioEstrellas,
  ]);

  const agregarMensaje = useCallback(
    async (e) => {
      e.preventDefault();
      if (
        !mensajeEn.trim() &&
        !mensajeEs.trim() &&
        multimediaSeleccionada.length === 0
      )
        return;
      await guardarMensaje();
    },
    [mensajeEn, mensajeEs, multimediaSeleccionada, guardarMensaje],
  );

  const guardarEdicionHistoria = useCallback(
    async (e) => {
      e.preventDefault();
      if ((!editTituloEn.trim() && !editTituloEs.trim()) || !editandoHistoria)
        return;

      setGuardandoHistoria(true);
      const { error } = await supabase
        .from("historias")
        .update({
          titulo_en: editTituloEn.trim() || editTituloEs.trim(),
          titulo_es: editTituloEs.trim() || editTituloEn.trim(),
        })
        .eq("id", editandoHistoria.id);

      if (!error) {
        setMostrarEditorHistoria(false);
        setEditandoHistoria(null);
        setEditTituloEn("");
        setEditTituloEs("");
        await cargarHistorias();
        if (historiaActual?.id === editandoHistoria.id) {
          setHistoriaActual({
            ...historiaActual,
            titulo_en: editTituloEn.trim() || editTituloEs.trim(),
            titulo_es: editTituloEs.trim() || editTituloEn.trim(),
          });
        }
      }
      setGuardandoHistoria(false);
    },
    [
      editTituloEn,
      editTituloEs,
      editandoHistoria,
      cargarHistorias,
      historiaActual,
    ],
  );

  const iniciarEdicion = useCallback(
    async (mensaje) => {
      if (!mensaje?.id) {
        return;
      }

      setCargandoEditor(true);
      setMostrarEditor(true);
      try {
        setEditandoMensaje(mensaje);
        setEditMensajeEn(mensaje.mensaje_en || "");
        setEditMensajeEs(mensaje.mensaje_es || "");

        const multimedia = await cargarMultimediaDeMensaje(mensaje.id);
        setEditMultimediaSeleccionada(
          multimedia.map((m) => ({ ...m, tipo: m.tipo })),
        );
        setMostrarEditorMultimedia(false);
      } catch (e) {
        console.error("Error cargando editor:", e);
        setMostrarEditor(false);
      } finally {
        setCargandoEditor(false);
      }
    },
    [cargarMultimediaDeMensaje],
  );

  const guardarEdicionMensaje = useCallback(async () => {
    if (!editandoMensaje) return;
    setGuardandoEdicionMensaje(true);

    try {
      await supabase
        .from("mensajes")
        .update({
          mensaje_en: editMensajeEn.trim() || editMensajeEs.trim() || "",
          mensaje_es: editMensajeEs.trim() || editMensajeEn.trim() || "",
          tiene_multimedia: editMultimediaSeleccionada.length > 0,
          bloqueado:
            editMultimediaSeleccionada.length > 0 && editandoMensaje.bloqueado,
          precio_estrellas:
            editMultimediaSeleccionada.length > 0
              ? Number(editandoMensaje.precio_estrellas) || 0
              : 0,
        })
        .eq("id", editandoMensaje.id);

      const multimediaExistente = await cargarMultimediaDeMensaje(
        editandoMensaje.id,
      );
      const nuevosFileUniqueIds = editMultimediaSeleccionada.map(
        (m) => m.file_unique_id,
      );
      const existentesFileUniqueIds = multimediaExistente.map(
        (m) => m.file_unique_id,
      );

      for (const fileUniqueId of existentesFileUniqueIds) {
        if (!nuevosFileUniqueIds.includes(fileUniqueId)) {
          await supabase
            .from("multimedia")
            .update({ mensaje_id: null })
            .eq("file_unique_id", fileUniqueId)
            .eq("mensaje_id", editandoMensaje.id);
        }
      }

      for (let i = 0; i < editMultimediaSeleccionada.length; i++) {
        const item = editMultimediaSeleccionada[i];
        const existe = multimediaExistente.some(
          (m) => m.file_unique_id === item.file_unique_id,
        );

        if (existe) {
          await supabase
            .from("multimedia")
            .update({ orden: i })
            .eq("file_unique_id", item.file_unique_id)
            .eq("mensaje_id", editandoMensaje.id);
        } else {
          const { data: existingFile } = await supabase
            .from("multimedia")
            .select("id")
            .eq("file_unique_id", item.file_unique_id)
            .maybeSingle();

          if (existingFile) {
            await supabase
              .from("multimedia")
              .update({
                mensaje_id: editandoMensaje.id,
                orden: i,
              })
              .eq("id", existingFile.id);
          } else {
            await supabase.from("multimedia").insert({
              mensaje_id: editandoMensaje.id,
              tipo: item.tipo,
              file_id: item.file_id,
              file_unique_id: item.file_unique_id,
              caption: item.caption || "",
              duracion_texto: item.duracion_texto || "",
              orden: i,
            });
          }
        }
      }

      setMostrarEditor(false);
      setEditandoMensaje(null);
      setEditMensajeEn("");
      setEditMensajeEs("");
      setEditMultimediaSeleccionada([]);
      setMostrarEditorMultimedia(false);
      await recargarTodo(historiaActual.id, [editandoMensaje.id]);
    } catch (e) {
      console.error(" Error en guardarEdicionMensaje:", e);
    }
    setGuardandoEdicionMensaje(false);
  }, [
    editandoMensaje,
    editMensajeEn,
    editMensajeEs,
    editMultimediaSeleccionada,
    cargarMultimediaDeMensaje,
    historiaActual,
    recargarTodo,
  ]);

  const agregarOpcionConfig = useCallback(() => {
    setOpcionesConfig((prev) => [
      ...prev,
      {
        texto: "",
        textoEs: "",
        mensajes: [],
        mensajeTemp: {
          mensajeEn: "",
          mensajeEs: "",
          multimedia: [],
          esBloqueado: false,
          precioEstrellas: 0,
        },
        mostrarMultimedia: false,
        expandido: true,
      },
    ]);
  }, []);

  const actualizarTextoOpcionConfig = useCallback((index, texto) => {
    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      nuevos[index].texto = texto;
      return nuevos;
    });
  }, []);

  const actualizarTextoOpcionEsConfig = useCallback((index, texto) => {
    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      nuevos[index].textoEs = texto;
      return nuevos;
    });
  }, []);

  const eliminarOpcionConfig = useCallback((index) => {
    setOpcionesConfig((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const agregarMensajeAOpcionConfig = useCallback(
    (index) => {
      const opcion = opcionesConfig[index];
      const tieneMensaje =
        opcion.mensajeTemp.mensajeEn.trim() !== "" ||
        opcion.mensajeTemp.mensajeEs.trim() !== "";
      const tieneMultimedia = opcion.mensajeTemp.multimedia.length > 0;

      if (!tieneMensaje && !tieneMultimedia) {
        return;
      }

      setOpcionesConfig((prev) => {
        const nuevos = [...prev];
        const multimediaParaGuardar = opcion.mensajeTemp.multimedia.map(
          (item) => ({
            ...item,
            file_id: item.file_id,
            file_unique_id: item.file_unique_id,
            caption: item.caption || "",
            duracion_texto: item.duracion_texto || "",
            tipo: item.tipo,
          }),
        );

        nuevos[index].mensajes.push({
          id: null,
          mensajeEn:
            opcion.mensajeTemp.mensajeEn.trim() ||
            opcion.mensajeTemp.mensajeEs.trim() ||
            "",
          mensajeEs:
            opcion.mensajeTemp.mensajeEs.trim() ||
            opcion.mensajeTemp.mensajeEn.trim() ||
            "",
          multimedia: multimediaParaGuardar,
          bloqueado:
            opcion.mensajeTemp.multimedia.length > 0 &&
            Boolean(opcion.mensajeTemp.esBloqueado),
          precio_estrellas:
            opcion.mensajeTemp.multimedia.length > 0
              ? Number(opcion.mensajeTemp.precioEstrellas) || 0
              : 0,
        });
        nuevos[index].mensajeTemp = {
          mensajeEn: "",
          mensajeEs: "",
          multimedia: [],
          esBloqueado: false,
          precioEstrellas: 0,
        };
        nuevos[index].mostrarMultimedia = false;
        return nuevos;
      });
    },
    [opcionesConfig],
  );

  const eliminarMensajeOpcionConfig = useCallback(
    (opcionIndex, mensajeIndex) => {
      setOpcionesConfig((prev) => {
        const nuevos = [...prev];
        nuevos[opcionIndex].mensajes = nuevos[opcionIndex].mensajes.filter(
          (_, i) => i !== mensajeIndex,
        );
        return nuevos;
      });
    },
    [],
  );

  const actualizarMensajeTempOpcion = useCallback((index, campo, valor) => {
    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      nuevos[index].mensajeTemp[campo] = valor;
      return nuevos;
    });
  }, []);

  const toggleExpandirOpcion = useCallback((index) => {
    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      nuevos[index].expandido = !nuevos[index].expandido;
      return nuevos;
    });
  }, []);

  const toggleMostrarMultimediaOpcion = useCallback((index) => {
    setOpcionesConfig((prev) => {
      const nuevos = [...prev];
      nuevos[index].mostrarMultimedia = !nuevos[index].mostrarMultimedia;
      return nuevos;
    });
  }, []);

  const guardarOpcionesCompletas = useCallback(async () => {
    if (!historiaActual || opcionesConfig.length === 0) return;
    setGuardandoOpciones(true);

    try {
      const opcionesValidas = opcionesConfig.filter(
        (op) => op.texto.trim() !== "" || op.textoEs.trim() !== "",
      );
      if (opcionesValidas.length === 0) {
        setGuardandoOpciones(false);
        return;
      }

      const textosOpciones = opcionesValidas.map(
        (b) => b.texto.trim() || b.textoEs.trim(),
      );
      const ordenActual = secuencia.length;

      const { data: mensajeData, error: mensajeError } = await supabase
        .from("mensajes")
        .insert([
          {
            historia_id: historiaActual.id,
            mensaje_en: `[OPCION] ${textosOpciones.join(", ")}`,
            mensaje_es: `[OPCION] ${opcionesValidas.map((o) => o.textoEs || o.texto).join(", ")}`,
            tiene_multimedia: false,
            bloqueado: false,
            precio_estrellas: 0,
          },
        ])
        .select();

      if (mensajeError) throw mensajeError;
      if (!mensajeData) throw new Error("Error creando mensaje placeholder");

      const mensajeId = mensajeData[0].id;
      const { data: opcionInsert, error: opcionError } = await supabase
        .from("secuencia")
        .insert({
          historia_id: historiaActual.id,
          tipo: "opcion",
          mensaje_id: mensajeId,
          texto_opcion_en: JSON.stringify(textosOpciones),
          texto_opcion_es: JSON.stringify(
            opcionesValidas.map((o) => o.textoEs || o.texto),
          ),
          orden_visual: ordenActual,
        })
        .select();

      if (opcionError) throw opcionError;
      if (!opcionInsert) throw new Error("Error creando opción");

      const opcionId = opcionInsert[0].id;
      let ordenMensaje = 0;
      const mensajesCreados = [];

      for (let i = 0; i < opcionesValidas.length; i++) {
        const opcionData = opcionesValidas[i];
        for (const msg of opcionData.mensajes) {
          const { data: mensajeCreado, error: mensajeError2 } = await supabase
            .from("mensajes")
            .insert([
              {
                historia_id: historiaActual.id,
                mensaje_en: msg.mensajeEn || msg.mensaje || msg.mensajeEs || "",
                mensaje_es: msg.mensajeEs || msg.mensajeEn || msg.mensaje || "",
                tiene_multimedia: msg.multimedia?.length > 0,
                bloqueado: msg.multimedia?.length > 0 && msg.bloqueado,
                precio_estrellas:
                  msg.multimedia?.length > 0
                    ? Number(msg.precio_estrellas) || 0
                    : 0,
              },
            ])
            .select();

          if (mensajeError2) continue;
          if (!mensajeCreado) continue;

          const mensajeId2 = mensajeCreado[0].id;
          mensajesCreados.push(mensajeId2);

          if (msg.multimedia?.length > 0) {
            for (const item of msg.multimedia) {
              const { data: existingMedia } = await supabase
                .from("multimedia")
                .select("id")
                .eq("file_unique_id", item.file_unique_id)
                .maybeSingle();

              if (existingMedia) {
                await supabase
                  .from("multimedia")
                  .update({
                    mensaje_id: mensajeId2,
                    orden: msg.multimedia.indexOf(item),
                  })
                  .eq("id", existingMedia.id);
              } else {
                await supabase.from("multimedia").insert({
                  mensaje_id: mensajeId2,
                  tipo: item.tipo,
                  file_id: item.file_id,
                  file_unique_id: item.file_unique_id,
                  caption: item.caption || "",
                  duracion_texto: item.duracion_texto || "",
                  orden: msg.multimedia.indexOf(item),
                });
              }
            }
          }

          await supabase.from("secuencia").insert({
            historia_id: historiaActual.id,
            tipo: "mensaje",
            mensaje_id: mensajeId2,
            padre_id: opcionId,
            orden_visual: ordenActual + 1 + ordenMensaje,
            metadata: JSON.stringify({ opcion_index: i }),
          });
          ordenMensaje++;
        }
      }

      setMostrarFormularioOpcion(false);
      setOpcionesConfig([]);
      setOpcionEditando(null);
      await recargarTodo(historiaActual.id, mensajesCreados);
    } catch (e) {
      console.error(" Error en guardarOpcionesCompletas:", e);
    } finally {
      setGuardandoOpciones(false);
    }
  }, [historiaActual, opcionesConfig, secuencia, recargarTodo]);

  const actualizarOpcionExistente = useCallback(async () => {
    if (!historiaActual || !opcionEditando || opcionesConfig.length === 0)
      return;
    setGuardandoOpciones(true);

    try {
      const opcionesValidas = opcionesConfig.filter(
        (op) => op.texto.trim() !== "" || op.textoEs.trim() !== "",
      );
      if (opcionesValidas.length === 0) {
        setGuardandoOpciones(false);
        return;
      }

      const textosOpciones = opcionesValidas.map(
        (b) => b.texto.trim() || b.textoEs.trim(),
      );
      await supabase
        .from("secuencia")
        .update({
          texto_opcion_en: JSON.stringify(textosOpciones),
          texto_opcion_es: JSON.stringify(
            opcionesValidas.map((o) => o.textoEs || o.texto),
          ),
        })
        .eq("id", opcionEditando.id);

      const hijos = secuencia.filter((s) => s.padre_id === opcionEditando.id);
      for (const hijo of hijos) {
        if (hijo.mensaje_id) {
          await supabase
            .from("multimedia")
            .update({ mensaje_id: null })
            .eq("mensaje_id", hijo.mensaje_id);
          await supabase.from("mensajes").delete().eq("id", hijo.mensaje_id);
        }
        await supabase.from("secuencia").delete().eq("id", hijo.id);
      }

      let ordenActual =
        secuencia.findIndex((s) => s.id === opcionEditando.id) + 1;
      let ordenMensaje = 0;
      const mensajesCreados = [];

      for (let i = 0; i < opcionesValidas.length; i++) {
        const opcionData = opcionesValidas[i];
        for (const msg of opcionData.mensajes) {
          const { data: mensajeCreado } = await supabase
            .from("mensajes")
            .insert([
              {
                historia_id: historiaActual.id,
                mensaje_en: msg.mensajeEn || msg.mensaje || msg.mensajeEs || "",
                mensaje_es: msg.mensajeEs || msg.mensajeEn || msg.mensaje || "",
                tiene_multimedia: msg.multimedia?.length > 0,
                bloqueado: msg.multimedia?.length > 0 && msg.bloqueado,
                precio_estrellas:
                  msg.multimedia?.length > 0
                    ? Number(msg.precio_estrellas) || 0
                    : 0,
              },
            ])
            .select();

          if (!mensajeCreado) continue;
          const mensajeId = mensajeCreado[0].id;
          mensajesCreados.push(mensajeId);

          if (msg.multimedia?.length > 0) {
            for (const item of msg.multimedia) {
              const { data: existingMedia } = await supabase
                .from("multimedia")
                .select("id")
                .eq("file_unique_id", item.file_unique_id)
                .maybeSingle();

              if (existingMedia) {
                await supabase
                  .from("multimedia")
                  .update({
                    mensaje_id: mensajeId,
                    orden: msg.multimedia.indexOf(item),
                  })
                  .eq("id", existingMedia.id);
              } else {
                await supabase.from("multimedia").insert({
                  mensaje_id: mensajeId,
                  tipo: item.tipo,
                  file_id: item.file_id,
                  file_unique_id: item.file_unique_id,
                  caption: item.caption || "",
                  duracion_texto: item.duracion_texto || "",
                  orden: msg.multimedia.indexOf(item),
                });
              }
            }
          }

          await supabase.from("secuencia").insert({
            historia_id: historiaActual.id,
            tipo: "mensaje",
            mensaje_id: mensajeId,
            padre_id: opcionEditando.id,
            orden_visual: ordenActual + ordenMensaje,
            metadata: JSON.stringify({ opcion_index: i }),
          });
          ordenMensaje++;
        }
      }

      setMostrarFormularioOpcion(false);
      setOpcionesConfig([]);
      setOpcionEditando(null);
      await recargarTodo(historiaActual.id, mensajesCreados);
    } catch (e) {
      console.error(" Error en actualizarOpcionExistente:", e);
    } finally {
      setGuardandoOpciones(false);
    }
  }, [historiaActual, opcionEditando, opcionesConfig, secuencia, recargarTodo]);

  const editarOpcionExistente = useCallback(
    async (item) => {
      try {
        const opciones = JSON.parse(item.texto_opcion_en || "[]");
        const opcionesEs = JSON.parse(
          item.texto_opcion_es || item.texto_opcion_en || "[]",
        );
        const hijos = secuencia.filter((s) => s.padre_id === item.id);
        const mensajesPorOpcion = {};

        for (const hijo of hijos) {
          const metadata = JSON.parse(hijo.metadata || "{}");
          const opcionIndex = metadata.opcion_index || 0;
          const mensaje = mensajes.find((m) => m.id === hijo.mensaje_id);
          if (mensaje) {
            if (!mensajesPorOpcion[opcionIndex])
              mensajesPorOpcion[opcionIndex] = [];
            const multimedia = await cargarMultimediaDeMensaje(mensaje.id);
            mensajesPorOpcion[opcionIndex].push({
              id: mensaje.id,
              mensajeEn: mensaje.mensaje_en || "",
              mensajeEs: mensaje.mensaje_es || mensaje.mensaje_en || "",
              multimedia: multimedia.map((m) => ({
                ...m,
                tipo:
                  m.tipo || (m.file_id?.startsWith("BA") ? "video" : "foto"),
              })),
              bloqueado: multimedia.length > 0 && Boolean(mensaje.bloqueado),
              precio_estrellas:
                multimedia.length > 0
                  ? Number(mensaje.precio_estrellas) || 0
                  : 0,
            });
          }
        }

        const config = opciones.map((texto, index) => ({
          texto: texto,
          textoEs: opcionesEs[index] || texto,
          mensajes: mensajesPorOpcion[index] || [],
          mensajeTemp: {
            mensajeEn: "",
            mensajeEs: "",
            multimedia: [],
            esBloqueado: false,
            precioEstrellas: 0,
          },
          mostrarMultimedia: false,
          expandido: true,
        }));

        setOpcionesConfig(config);
        setOpcionEditando(item);
        setMostrarFormularioOpcion(true);
      } catch (e) {
        console.error(" Error en editarOpcionExistente:", e);
      }
    },
    [secuencia, mensajes, cargarMultimediaDeMensaje],
  );

  const toggleMultimedia = useCallback(
    (item, tipo, coleccion, setColeccion, mensajeIdIgnorar = null) => {
      if (verificarMultimediaEnUso(item.file_unique_id, mensajeIdIgnorar)) {
        return;
      }

      const existe = coleccion.some(
        (m) => m.file_unique_id === item.file_unique_id && m.tipo === tipo,
      );
      if (existe) {
        const nuevaColeccion = coleccion.filter(
          (m) => !(m.file_unique_id === item.file_unique_id && m.tipo === tipo),
        );
        setColeccion(nuevaColeccion);

        if (
          setColeccion === setMultimediaSeleccionada &&
          nuevaColeccion.length === 0
        ) {
          setFormEsBloqueado(false);
          setFormPrecioEstrellas(0);
        }

      } else {
        setColeccion([...coleccion, { ...item, tipo }]);
      }
    },
    [verificarMultimediaEnUso],
  );

  const verMensajeCompleto = useCallback(
    async (mensaje) => {
      if (!mensaje?.id) return;
      setCargandoMensajeCompleto(true);
      setMensajeCompleto(mensaje);
      setMostrarMensajeCompleto(true);

      try {
        await Promise.all([
          cargarEstadisticasParaMensajes([mensaje.id]),
          cargarMultimediaParaMensajes([mensaje.id]),
        ]);
      } catch (e) {
        console.error("Error cargando datos del mensaje:", e);
      } finally {
        setCargandoMensajeCompleto(false);
      }
    },
    [cargarEstadisticasParaMensajes, cargarMultimediaParaMensajes],
  );

  const logout = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }

    setHistorias([]);
    setHistoriaActual(null);
    setMensajes([]);
    setSecuencia([]);
    setMensajesMultimedia({});
    setEstadisticasMensajes({});
    setMostrarEditor(false);
    setMostrarEditorHistoria(false);
    setMostrarFormularioOpcion(false);
    setOpcionesConfig([]);
    setFormEsBloqueado(false);
    setFormPrecioEstrellas(0);
    setMostrarModalBloqueado(false);
    initialLoadDone.current = false;
  }, [onBack]);

  const renderArbol = useMemo(() => {
    if (secuencia.length === 0) {
      return (
        <div className="historias-arbol-vacio">
          <FaTree className="historias-arbol-vacio-icono" />
          <p>No hay elementos en la secuencia</p>
          <p className="historias-arbol-vacio-sub">
            Agrega un mensaje o una opción para comenzar
          </p>
        </div>
      );
    }

    return secuencia.map((item, index) => {
      const esOpcion = item.tipo === "opcion";
      const mensaje = esOpcion
        ? null
        : mensajes.find((m) => m.id === item.mensaje_id);
      const tieneMultimedia =
        mensaje && mensajesMultimedia[mensaje.id]?.length > 0;
      const cantidadMultimedia =
        mensaje && mensajesMultimedia[mensaje.id]
          ? mensajesMultimedia[mensaje.id].length
          : 0;
      const opcionesEn = esOpcion
        ? JSON.parse(item.texto_opcion_en || "[]")
        : [];
      const opcionesEs = esOpcion
        ? JSON.parse(item.texto_opcion_es || item.texto_opcion_en || "[]")
        : [];
      const opciones = opcionesEn;
      const tieneHijos =
        esOpcion && secuencia.some((s) => s.padre_id === item.id);
      const estaExpandido = opcionesExpandidas[item.id] !== false;
      const esBloqueado = Boolean(tieneMultimedia && mensaje?.bloqueado);

      if (!esOpcion && item.padre_id) return null;

      return (
        <div key={item.id} className="historias-arbol-nodo">
          <div
            className={`historias-arbol-nodo-contenido ${esOpcion ? "historias-es-opcion" : "historias-es-mensaje"} ${tieneMultimedia ? "tiene-multimedia" : ""} ${esBloqueado ? "historias-es-bloqueado" : ""}`}
          >
            <div className="historias-arbol-nodo-posicion">#{index + 1}</div>
            <div className="historias-arbol-nodo-icono">
              {esOpcion ? <FaLink /> : esBloqueado ? <FaStar /> : <FaFeather />}
            </div>
            <div className="historias-arbol-nodo-info">
              {esOpcion ? (
                <>
                  <span className="historias-arbol-nodo-tipo-opcion">
                    {" "}
                    OPCIÓN
                  </span>
                  <span className="historias-arbol-nodo-opciones">
                    {opciones.map((b, i) => (
                      <span
                        key={i}
                        className="historias-arbol-opcion-tag historias-bilingue-tag"
                      >
                        <span>
                          <strong>EN:</strong> {b || "(Sin texto)"}
                        </span>
                        <span>
                          <strong>ES:</strong> {opcionesEs[i] || "(Sin texto)"}
                        </span>
                      </span>
                    ))}
                  </span>
                  <span className="historias-arbol-nodo-badge">
                    {opciones.length} opción(es)
                    {tieneHijos &&
                      ` • ${secuencia.filter((s) => s.padre_id === item.id).length} mensaje(s)`}
                  </span>
                </>
              ) : (
                <>
                  <span className="historias-arbol-nodo-tipo-mensaje">
                    {esBloqueado ? " BLOQUEADO" : " MENSAJE"}
                  </span>
                  <span
                    className="historias-arbol-nodo-contenido-texto historias-clickeable"
                    onClick={() => verMensajeCompleto(mensaje)}
                    title="Click para ver mensaje completo"
                  >
                    <span className="historias-mensaje-preview-idioma">
                      <strong>EN:</strong>{" "}
                      {mensaje?.mensaje_en || "(Sin mensaje)"}
                    </span>
                    <span className="historias-mensaje-preview-idioma">
                      <strong>ES:</strong>{" "}
                      {mensaje?.mensaje_es || "(Sin mensaje)"}
                    </span>
                  </span>
                  {tieneMultimedia && (
                    <span
                      className="historias-arbol-nodo-badge-multimedia historias-clickeable"
                      onClick={() => verMensajeCompleto(mensaje)}
                      title="Click para ver contenido"
                    >
                      <FaPaperclip /> {cantidadMultimedia}
                    </span>
                  )}
                  {esBloqueado && (
                    <span className="historias-arbol-nodo-badge-bloqueado">
                      ⭐ {mensaje?.precio_estrellas || 0}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="historias-arbol-nodo-acciones">
              {esOpcion ? (
                <>
                  <BotonConCarga
                    onClick={() => moverMensaje(item.id, "arriba")}
                    cargando={moviendoItem && itemIdEnMovimiento === item.id}
                    texto=""
                    icono={<FaArrowUp />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-arbol-btn-mover"
                    disabled={index === 0 || moviendoItem}
                    title="Mover arriba"
                  />
                  <BotonConCarga
                    onClick={() => moverMensaje(item.id, "abajo")}
                    cargando={moviendoItem && itemIdEnMovimiento === item.id}
                    texto=""
                    icono={<FaArrowDown />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-arbol-btn-mover"
                    disabled={index === secuencia.length - 1 || moviendoItem}
                    title="Mover abajo"
                  />
                  <button
                    onClick={() => editarOpcionExistente(item)}
                    className="historias-arbol-btn-editar"
                    title="Editar opción"
                  >
                    <FaEdit />
                  </button>
                  <BotonConCarga
                    onClick={() =>
                      setConfirmarEliminacion({
                        tipo: "opcion",
                        id: item.id,
                        mensaje: "¿Eliminar esta opción y todos sus mensajes?",
                      })
                    }
                    cargando={eliminandoItem && itemIdEnEliminacion === item.id}
                    texto=""
                    icono={<FaTrash />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-arbol-btn-eliminar"
                    disabled={eliminandoItem}
                    title="Eliminar opción"
                  />
                </>
              ) : (
                <>
                  <BotonConCarga
                    onClick={() => moverMensaje(item.id, "arriba")}
                    cargando={moviendoItem && itemIdEnMovimiento === item.id}
                    texto=""
                    icono={<FaArrowUp />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-arbol-btn-mover"
                    disabled={index === 0 || moviendoItem}
                    title="Mover arriba"
                  />
                  <BotonConCarga
                    onClick={() => moverMensaje(item.id, "abajo")}
                    cargando={moviendoItem && itemIdEnMovimiento === item.id}
                    texto=""
                    icono={<FaArrowDown />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-arbol-btn-mover"
                    disabled={index === secuencia.length - 1 || moviendoItem}
                    title="Mover abajo"
                  />
                </>
              )}
            </div>
          </div>

          {esOpcion && estaExpandido && tieneHijos && (
            <div className="historias-arbol-hijos">
              <div className="historias-arbol-hijos-header">
                <FaFolderOpen /> Mensajes por opción:
              </div>
              {opciones.map((texto, opcionIdx) => {
                const hijosOpcion = secuencia.filter((s) => {
                  if (s.padre_id !== item.id) return false;
                  const metadata = JSON.parse(s.metadata || "{}");
                  return metadata.opcion_index === opcionIdx;
                });

                return (
                  <div key={opcionIdx} className="historias-arbol-rama-opcion">
                    <div className="historias-arbol-rama-opcion-header">
                      <span className="historias-arbol-rama-opcion-icono"></span>
                      <span className="historias-arbol-rama-opcion-texto historias-bilingue-visual">
                        <span>
                          <strong>EN:</strong> {texto || "(Sin texto)"}
                        </span>
                        <span>
                          <strong>ES:</strong>{" "}
                          {opcionesEs[opcionIdx] || "(Sin texto)"}
                        </span>
                      </span>
                      <span className="historias-arbol-rama-opcion-badge">
                        {hijosOpcion.length} mensaje(s)
                      </span>
                    </div>
                    {hijosOpcion.length > 0 ? (
                      <div className="historias-arbol-rama-mensajes">
                        {hijosOpcion.map((hijo, idx) => {
                          const msg = mensajes.find(
                            (m) => m.id === hijo.mensaje_id,
                          );
                          if (!msg) return null;
                          const tieneMult =
                            mensajesMultimedia[msg.id]?.length > 0;
                          const cantMult =
                            mensajesMultimedia[msg.id]?.length || 0;
                          return (
                            <div
                              key={hijo.id}
                              className="historias-arbol-mensaje-hijo"
                            >
                              <span className="historias-arbol-mensaje-hijo-num">
                                #{idx + 1}
                              </span>
                              <span
                                className="historias-arbol-mensaje-hijo-contenido historias-clickeable historias-bilingue-visual"
                                onClick={() => verMensajeCompleto(msg)}
                                title="Click para ver mensaje completo"
                              >
                                <span>
                                  <strong>EN:</strong>{" "}
                                  {msg.mensaje_en || "(Sin texto)"}
                                </span>
                                <span>
                                  <strong>ES:</strong>{" "}
                                  {msg.mensaje_es || "(Sin texto)"}
                                </span>
                              </span>
                              {tieneMult && (
                                <span
                                  className="historias-arbol-mensaje-hijo-multimedia historias-clickeable"
                                  onClick={() => verMensajeCompleto(msg)}
                                  title="Click para ver contenido"
                                >
                                  <FaPaperclip /> {cantMult}
                                </span>
                              )}
                              {msg.bloqueado && (
                                <span className="historias-arbol-nodo-badge-bloqueado">
                                  ⭐ {msg.precio_estrellas || 0}
                                </span>
                              )}
                              <div className="historias-arbol-mensaje-hijo-acciones">
                                <BotonConCarga
                                  onClick={() =>
                                    moverMensajeOpcion(
                                      item.id,
                                      hijo.id,
                                      "arriba",
                                    )
                                  }
                                  cargando={
                                    moviendoItem &&
                                    itemIdEnMovimiento === hijo.id
                                  }
                                  texto=""
                                  icono={<FaArrowUp />}
                                  iconoCargando={
                                    <FaSpinner className="historias-spin" />
                                  }
                                  className="historias-arbol-btn-mover"
                                  disabled={idx === 0 || moviendoItem}
                                  title="Mover mensaje arriba"
                                />
                                <BotonConCarga
                                  onClick={() =>
                                    moverMensajeOpcion(
                                      item.id,
                                      hijo.id,
                                      "abajo",
                                    )
                                  }
                                  cargando={
                                    moviendoItem &&
                                    itemIdEnMovimiento === hijo.id
                                  }
                                  texto=""
                                  icono={<FaArrowDown />}
                                  iconoCargando={
                                    <FaSpinner className="historias-spin" />
                                  }
                                  className="historias-arbol-btn-mover"
                                  disabled={
                                    idx === hijosOpcion.length - 1 ||
                                    moviendoItem
                                  }
                                  title="Mover mensaje abajo"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="historias-arbol-rama-vacia">
                        Sin mensajes
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }, [
    secuencia,
    mensajes,
    mensajesMultimedia,
    opcionesExpandidas,
    moviendoItem,
    itemIdEnMovimiento,
    eliminandoItem,
    itemIdEnEliminacion,
    verMensajeCompleto,
    moverMensaje,
    moverMensajeOpcion,
    editarOpcionExistente,
  ]);

  const renderModales = () => (
    <>
      {confirmarEliminacion && (
        <div className="historias-confirm-overlay">
          <div className="historias-confirm-modal">
            <div className="historias-confirm-icon">
              <FaTrash />
            </div>
            <h3>Confirmar eliminación</h3>
            <p>{confirmarEliminacion.mensaje}</p>
            <div className="historias-confirm-actions">
              <BotonConCarga
                onClick={() => {
                  if (confirmarEliminacion.tipo === "historia")
                    eliminarHistoria(confirmarEliminacion.id);
                  else if (confirmarEliminacion.tipo === "opcion")
                    eliminarOpcionCompleta(confirmarEliminacion.id);
                  else if (confirmarEliminacion.tipo === "mensaje")
                    eliminarMensajeIndividual(
                      confirmarEliminacion.mensajeId,
                      confirmarEliminacion.id,
                    );
                  setConfirmarEliminacion(null);
                }}
                cargando={eliminandoItem}
                texto="Eliminar"
                icono={<FaTrash />}
                iconoCargando={<FaSpinner className="historias-spin" />}
                className="historias-btn-confirmar-eliminar"
              />
              <button
                onClick={() => setConfirmarEliminacion(null)}
                className="historias-btn-cancelar-eliminar"
              >
                <FaTimes /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarMensajeCompleto && mensajeCompleto && (
        <div
          className="historias-mensaje-completo-overlay"
          onClick={() => setMostrarMensajeCompleto(false)}
        >
          <div
            className="historias-mensaje-completo-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="historias-mensaje-completo-header">
              <h3>
                <FaFeather /> Mensaje completo
                {mensajeCompleto?.bloqueado && (
                  <span className="historias-badge-bloqueado-modal">
                    {" "}
                    BLOQUEADO
                  </span>
                )}
              </h3>
              <button
                onClick={() => setMostrarMensajeCompleto(false)}
                className="historias-btn-cerrar-mensaje"
              >
                <FaTimes />
              </button>
            </div>
            <div className="historias-mensaje-completo-contenido">
              {cargandoMensajeCompleto ? (
                <div className="historias-cargando-mensaje-completo">
                  <FaSpinner className="historias-spin" />
                  <p>Cargando datos del mensaje...</p>
                </div>
              ) : (
                <>
                  <div className="historias-mensaje-idiomas-completo">
                    <div className="historias-mensaje-idioma-bloque">
                      <div className="historias-mensaje-idioma-etiqueta">
                        English
                      </div>
                      <p className="historias-mensaje-texto-completo">
                        {mensajeCompleto.mensaje_en ||
                          "(Sin mensaje en inglés)"}
                      </p>
                    </div>
                    <div className="historias-mensaje-idioma-bloque">
                      <div className="historias-mensaje-idioma-etiqueta">
                        Español
                      </div>
                      <p className="historias-mensaje-texto-completo">
                        {mensajeCompleto.mensaje_es ||
                          "(Sin mensaje en español)"}
                      </p>
                    </div>
                  </div>
                  {mensajeCompleto?.bloqueado && (
                    <div className="historias-mensaje-completo-estadisticas">
                      <span className="historias-badge-bloqueado-estadistica">
                        {mensajeCompleto.precio_estrellas || 0} ⭐
                      </span>
                    </div>
                  )}
                  {mensajesMultimedia[mensajeCompleto.id]?.length > 0 && (
                    <div className="historias-mensaje-completo-multimedia">
                      <h4>
                        <FaPaperclip /> Contenido (
                        {mensajesMultimedia[mensajeCompleto.id].length})
                      </h4>
                      <div className="historias-multimedia-grid-completo">
                        {mensajesMultimedia[mensajeCompleto.id].map(
                          (item, index) => (
                            <div
                              key={index}
                              className="historias-multimedia-item-completo"
                            >
                              <div className="historias-multimedia-icono">
                                {item.tipo === "video" ? (
                                  <FaVideo />
                                ) : (
                                  <FaCamera />
                                )}
                              </div>
                              <div className="historias-multimedia-detalle-completo">
                                <span className="historias-multimedia-tipo">
                                  {item.tipo}
                                </span>
                                {item.caption && (
                                  <span className="historias-multimedia-caption">
                                    "{item.caption}"
                                  </span>
                                )}
                                {item.duracion_texto && (
                                  <span className="historias-multimedia-duracion">
                                    {item.duracion_texto}
                                  </span>
                                )}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {!cargandoMensajeCompleto && (
              <div className="historias-mensaje-completo-actions">
                <button
                  onClick={() => {
                    setMostrarMensajeCompleto(false);
                    iniciarEdicion(mensajeCompleto);
                  }}
                  className="historias-btn-editar-mensaje-completo"
                >
                  <FaEdit /> Editar
                </button>
                {(estadisticasMensajes[mensajeCompleto?.id]?.multimedia
                  ?.length > 0 ||
                  mensajeCompleto?.multimedia?.length > 0) && (
                  <button
                    onClick={() => {
                      setMostrarMensajeCompleto(false);
                      abrirBloqueadoCompleto(mensajeCompleto);
                    }}
                    className={`historias-btn-bloqueado-mensaje-completo ${mensajeCompleto?.bloqueado ? "historias-activo" : ""}`}
                  >
                    <FaStar />{" "}
                    {mensajeCompleto?.bloqueado
                      ? "Bloqueado historias-activo"
                      : "Activar bloqueado"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMostrarMensajeCompleto(false);
                    setConfirmarEliminacion({
                      tipo: "mensaje",
                      id: secuencia.find(
                        (s) => s.mensaje_id === mensajeCompleto.id,
                      )?.id,
                      mensajeId: mensajeCompleto.id,
                      mensaje: "Eliminar este mensaje?",
                    });
                  }}
                  className="historias-btn-eliminar-mensaje-completo"
                >
                  <FaTrash /> Eliminar
                </button>
                <button
                  onClick={() => setMostrarMensajeCompleto(false)}
                  className="historias-btn-cerrar-mensaje-completo"
                >
                  <FaTimes /> Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {mostrarEditor && (
        <div className="historias-editor-mensaje-overlay">
          <div className="historias-editor-mensaje-modal">
            <h3>
              <FaEdit /> Editar
            </h3>
            {cargandoEditor ? (
              <div className="historias-cargando-editor">
                <FaSpinner className="historias-spin" />
                <p>Cargando mensaje...</p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  guardarEdicionMensaje();
                }}
                className="historias-form-editar-mensaje"
              >
                <div className="historias-bilingue-campos">
                  <div className="historias-bilingue-campo">
                    <label> English</label>
                    <textarea
                      placeholder="Message in English..."
                      value={editMensajeEn}
                      onChange={(e) => setEditMensajeEn(e.target.value)}
                      className="historias-input-mensaje"
                      rows="4"
                    />
                  </div>
                  <div className="historias-bilingue-campo">
                    <label> Español</label>
                    <textarea
                      placeholder="Mensaje en español..."
                      value={editMensajeEs}
                      onChange={(e) => setEditMensajeEs(e.target.value)}
                      className="historias-input-mensaje"
                      rows="4"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setMostrarEditorMultimedia(!mostrarEditorMultimedia)
                  }
                  className="historias-btn-selector-multimedia-small"
                >
                  <FaPaperclip />{" "}
                  {editMultimediaSeleccionada.length > 0
                    ? `${editMultimediaSeleccionada.length} archivo(s) historias-seleccionado(s)`
                    : "Agregar contenido"}
                </button>
                {mostrarEditorMultimedia && (
                  <SelectorMultimedia
                    videos={videosDisponibles}
                    fotos={fotosDisponibles}
                    seleccionados={editMultimediaSeleccionada}
                    onToggle={(item, tipo) =>
                      toggleMultimedia(
                        item,
                        tipo,
                        editMultimediaSeleccionada,
                        setEditMultimediaSeleccionada,
                        editandoMensaje?.id,
                      )
                    }
                    mensajeIdIgnorar={editandoMensaje?.id}
                    verificarEnUso={verificarMultimediaEnUso}
                  />
                )}
                <div className="historias-editor-actions">
                  <BotonConCarga
                    onClick={guardarEdicionMensaje}
                    cargando={guardandoEdicionMensaje}
                    texto="Guardar"
                    icono={<FaSave />}
                    iconoCargando={<FaSpinner className="historias-spin" />}
                    className="historias-btn-guardar-edicion"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarEditor(false);
                      setEditMultimediaSeleccionada([]);
                      setMostrarEditorMultimedia(false);
                    }}
                    className="historias-btn-cancelar-edicion"
                  >
                    <FaTimes /> Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {mostrarEditorHistoria && (
        <div className="historias-editor-historia-overlay">
          <div className="historias-editor-historia-modal">
            <h3>
              <FaEdit /> Editar
            </h3>
            <form
              onSubmit={guardarEdicionHistoria}
              className="historias-form-editar-historia"
            >
              <div className="historias-bilingue-campos historias-historia-titulos-bilingues">
                <div className="historias-bilingue-campo">
                  <label>English</label>
                  <input
                    type="text"
                    placeholder="Story title in English..."
                    value={editTituloEn}
                    onChange={(e) => setEditTituloEn(e.target.value)}
                    className="historias-input-titulo-edicion"
                  />
                </div>
                <div className="historias-bilingue-campo">
                  <label>Español</label>
                  <input
                    type="text"
                    placeholder="Título de la historia en español..."
                    value={editTituloEs}
                    onChange={(e) => setEditTituloEs(e.target.value)}
                    className="historias-input-titulo-edicion"
                  />
                </div>
              </div>
              <div className="historias-editor-actions">
                <BotonConCarga
                  onClick={guardarEdicionHistoria}
                  cargando={guardandoHistoria}
                  texto="Guardar"
                  icono={<FaSave />}
                  iconoCargando={<FaSpinner className="historias-spin" />}
                  className="historias-btn-guardar-edicion"
                />
                <button
                  type="button"
                  onClick={() => setMostrarEditorHistoria(false)}
                  className="historias-btn-cancelar-edicion"
                >
                  <FaTimes /> Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mostrarFormularioOpcion && (
        <div className="historias-editor-opcion-overlay">
          <div className="historias-editor-opcion-modal">
            <h3>
              {opcionEditando ? <FaEdit /> : <FaBolt />}
              {opcionEditando ? "Editar opciones" : "Nuevas opciones"}
            </h3>
            <p className="historias-editor-opcion-subtitulo">
              Crea una o más opciones que los usuarios escribirán en el chat.{" "}
              <strong>Cada opción tendrá sus propios mensajes.</strong>
              <br />
              <span className="historias-highlight">
                Los usuarios escribirán el número o el texto de la opción.
              </span>
            </p>

            <div className="historias-opciones-config-container">
              {opcionesConfig.map((opcion, index) => {
                return (
                  <div key={index} className="historias-opcion-config-card">
                    <div className="historias-opcion-config-header">
                      <span className="historias-opcion-config-numero">
                        Opción #{index + 1}
                      </span>
                      <div className="historias-opcion-config-acciones">
                        <button
                          onClick={() => toggleExpandirOpcion(index)}
                          className="historias-btn-expandir-opcion-config"
                        >
                          {opcion.expandido ? (
                            <FaChevronDown />
                          ) : (
                            <FaChevronRight />
                          )}
                        </button>
                        {opcionesConfig.length > 1 && (
                          <button
                            onClick={() => eliminarOpcionConfig(index)}
                            className="historias-btn-eliminar-opcion-config"
                          >
                            <FaTrash />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="historias-opcion-config-texto historias-bilingue-campos">
                      <div className="historias-bilingue-campo">
                        <label> English</label>
                        <input
                          type="text"
                          placeholder="Example: Go to the forest"
                          value={opcion.texto}
                          onChange={(e) =>
                            actualizarTextoOpcionConfig(index, e.target.value)
                          }
                          className="historias-input-opcion-texto-config"
                        />
                      </div>
                      <div className="historias-bilingue-campo">
                        <label> Español</label>
                        <input
                          type="text"
                          placeholder="Ejemplo: Ir al bosque"
                          value={opcion.textoEs}
                          onChange={(e) =>
                            actualizarTextoOpcionEsConfig(index, e.target.value)
                          }
                          className="historias-input-opcion-texto-config"
                        />
                      </div>
                    </div>

                    {opcion.expandido && (
                      <div className="historias-opcion-config-mensajes">
                        <label>Mensajes de esta opción:</label>
                        {opcion.mensajes.length > 0 && (
                          <div className="historias-mensajes-opcion-lista">
                            {opcion.mensajes.map((msg, msgIndex) => {
                              const esMsgBloqueado = Boolean(
                                msg.multimedia?.length > 0 && msg.bloqueado,
                              );
                              return (
                                <div
                                  key={msgIndex}
                                  className="historias-mensaje-opcion-item"
                                >
                                  <span className="historias-mensaje-opcion-numero">
                                    {msgIndex + 1}.
                                  </span>
                                  <span className="historias-mensaje-opcion-contenido historias-bilingue-visual">
                                    <span>
                                      <strong>EN:</strong>{" "}
                                      {msg.mensajeEn || "(Sin texto)"}
                                    </span>
                                    <span>
                                      <strong>ES:</strong>{" "}
                                      {msg.mensajeEs || "(Sin texto)"}
                                    </span>
                                  </span>
                                  {msg.multimedia?.length > 0 && (
                                    <div className="historias-multimedia-preview-opcion">
                                      <span className="historias-badge-multimedia">
                                        <FaPaperclip /> {msg.multimedia.length}
                                      </span>
                                      <div className="historias-multimedia-items-opcion">
                                        {msg.multimedia.map((item, mIdx) => (
                                          <span
                                            key={mIdx}
                                            className="historias-multimedia-item-opcion"
                                          >
                                            {item.tipo === "video" ? (
                                              <FaVideo />
                                            ) : (
                                              <FaCamera />
                                            )}
                                            {item.caption || item.tipo}
                                            <button
                                              onClick={() => {
                                                setOpcionesConfig((prev) => {
                                                  const nuevos = [...prev];
                                                  const mensajeEditado =
                                                    nuevos[index].mensajes[
                                                      msgIndex
                                                    ];
                                                  mensajeEditado.multimedia =
                                                    mensajeEditado.multimedia.filter(
                                                      (_, i) => i !== mIdx,
                                                    );
                                                  if (
                                                    mensajeEditado.multimedia
                                                      .length === 0
                                                  ) {
                                                    mensajeEditado.bloqueado = false;
                                                    mensajeEditado.precio_estrellas = 0;
                                                  }
                                                  return nuevos;
                                                });
                                              }}
                                              className="historias-btn-quitar-multimedia-opcion"
                                            >
                                              <FaTimes />
                                            </button>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <button
                                    onClick={() =>
                                      eliminarMensajeOpcionConfig(
                                        index,
                                        msgIndex,
                                      )
                                    }
                                    className="historias-btn-eliminar-mensaje-opcion"
                                  >
                                    <FaTimes />
                                  </button>
                                  {msg.multimedia?.length > 0 && (
                                    <button
                                      className={`historias-btn-bloqueado-opcion-item ${
                                        esMsgBloqueado ? "historias-activo" : ""
                                      }`}
                                      onClick={() =>
                                        abrirBloqueadoOpcion(
                                          index,
                                          msgIndex,
                                          msg,
                                        )
                                      }
                                      title={
                                        esMsgBloqueado
                                          ? ` ${msg.precio_estrellas || 0} ⭐`
                                          : "Configurar Bloqueado"
                                      }
                                    >
                                      <FaStar />
                                      {esMsgBloqueado
                                        ? ` ${msg.precio_estrellas || 0} ⭐`
                                        : "Bloqueado"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="historias-mensaje-opcion-form">
                          <div className="historias-mensaje-form-row">
                            <div className="historias-bilingue-campos">
                              <div className="historias-bilingue-campo">
                                <label> English</label>
                                <textarea
                                  placeholder="Message in English..."
                                  value={opcion.mensajeTemp.mensajeEn}
                                  onChange={(e) =>
                                    actualizarMensajeTempOpcion(
                                      index,
                                      "mensajeEn",
                                      e.target.value,
                                    )
                                  }
                                  className="historias-input-mensaje-small"
                                  rows="2"
                                />
                              </div>
                              <div className="historias-bilingue-campo">
                                <label> Español</label>
                                <textarea
                                  placeholder="Mensaje en español..."
                                  value={opcion.mensajeTemp.mensajeEs}
                                  onChange={(e) =>
                                    actualizarMensajeTempOpcion(
                                      index,
                                      "mensajeEs",
                                      e.target.value,
                                    )
                                  }
                                  className="historias-input-mensaje-small"
                                  rows="2"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                toggleMostrarMultimediaOpcion(index)
                              }
                              className="historias-btn-selector-multimedia-small"
                            >
                              <FaPaperclip />{" "}
                              {opcion.mensajeTemp.multimedia.length > 0
                                ? `${opcion.mensajeTemp.multimedia.length} archivo(s)`
                                : "Contenido"}
                            </button>
                            {opcion.mensajeTemp.multimedia.length > 0 && (
                              <button
                                type="button"
                                onClick={() => abrirBloqueadoOpcionTemp(index)}
                                className={`historias-btn-bloqueado-opcion ${
                                  opcion.mensajeTemp.multimedia.length > 0 &&
                                  opcion.mensajeTemp.esBloqueado
                                    ? "historias-activo"
                                    : ""
                                }`}
                                title={
                                  opcion.mensajeTemp.esBloqueado
                                    ? ` ${opcion.mensajeTemp.precioEstrellas || 0} ⭐`
                                    : "Configurar Bloqueado"
                                }
                              >
                                <FaStar />{" "}
                                {opcion.mensajeTemp.esBloqueado
                                  ? ` ${opcion.mensajeTemp.precioEstrellas || 0} ⭐`
                                  : "Bloqueado"}
                              </button>
                            )}
                          </div>

                          {opcion.mostrarMultimedia && (
                            <SelectorMultimedia
                              videos={videosDisponibles}
                              fotos={fotosDisponibles}
                              seleccionados={opcion.mensajeTemp.multimedia}
                              onToggle={(item, tipo) => {
                                setOpcionesConfig((prev) => {
                                  const nuevos = [...prev];
                                  const existe = nuevos[
                                    index
                                  ].mensajeTemp.multimedia.some(
                                    (m) =>
                                      m.file_unique_id ===
                                        item.file_unique_id && m.tipo === tipo,
                                  );
                                  if (existe) {
                                    nuevos[index].mensajeTemp.multimedia =
                                      nuevos[
                                        index
                                      ].mensajeTemp.multimedia.filter(
                                        (m) =>
                                          !(
                                            m.file_unique_id ===
                                              item.file_unique_id &&
                                            m.tipo === tipo
                                          ),
                                      );
                                    if (
                                      nuevos[index].mensajeTemp.multimedia
                                        .length === 0
                                    ) {
                                      nuevos[index].mensajeTemp.esBloqueado =
                                        false;
                                      nuevos[
                                        index
                                      ].mensajeTemp.precioEstrellas = 0;
                                    }
                                  } else {
                                    if (
                                      verificarMultimediaEnUso(
                                        item.file_unique_id,
                                      )
                                    ) {
                                      return prev;
                                    }
                                    nuevos[index].mensajeTemp.multimedia.push({
                                      ...item,
                                      tipo,
                                    });
                                  }
                                  return nuevos;
                                });
                              }}
                              verificarEnUso={verificarMultimediaEnUso}
                            />
                          )}

                          <button
                            onClick={() => agregarMensajeAOpcionConfig(index)}
                            className="historias-btn-agregar-mensaje-opcion-small"
                          >
                            <FaPlus /> Agregar mensaje
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="historias-opcion-config-actions">
              <button
                onClick={agregarOpcionConfig}
                className="historias-btn-agregar-opcion-config"
              >
                <FaPlusCircle /> Agregar otra opción
              </button>
            </div>

            <div className="historias-editor-actions">
              <BotonConCarga
                onClick={
                  opcionEditando
                    ? actualizarOpcionExistente
                    : guardarOpcionesCompletas
                }
                cargando={guardandoOpciones}
                texto={opcionEditando ? "Actualizar" : "Guardar"}
                icono={<FaSave />}
                iconoCargando={<FaSpinner className="historias-spin" />}
                className="historias-btn-guardar-edicion"
                disabled={guardandoOpciones}
              />
              <button
                onClick={() => {
                  setMostrarFormularioOpcion(false);
                  setOpcionesConfig([]);
                  setOpcionEditando(null);
                }}
                className="historias-btn-cancelar-edicion"
                disabled={guardandoOpciones}
              >
                <FaTimes /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {modoBloqueado === "formulario" && (
        <ModalBloqueadoUnificado
          isOpen={mostrarModalBloqueado}
          onSave={guardarBloqueadoFormulario}
          onCancel={cancelarBloqueado}
          esBloqueado={formEsBloqueado}
          setEsBloqueado={setFormEsBloqueado}
          precioEstrellas={formPrecioEstrellas}
          setPrecioEstrellas={setFormPrecioEstrellas}
          titulo="Configurar Bloqueado para mensaje"
          subtitulo="Ingresa el número de ⭐ (ponga 0 para desactivar)"
        />
      )}

      {modoBloqueado === "completo" && (
        <ModalBloqueadoUnificado
          isOpen={mostrarModalBloqueado}
          onSave={guardarBloqueadoCompleto}
          onCancel={cancelarBloqueado}
          esBloqueado={completoEsBloqueado}
          setEsBloqueado={setCompletoEsBloqueado}
          precioEstrellas={completoPrecioEstrellas}
          setPrecioEstrellas={setCompletoPrecioEstrellas}
          titulo="Editar Bloqueado"
          subtitulo="Ingresa el número de ⭐ (ponga 0 para desactivar)"
        />
      )}

      {modoBloqueado === "opcion" && (
        <ModalBloqueadoUnificado
          isOpen={mostrarModalBloqueado}
          onSave={guardarBloqueadoOpcion}
          onCancel={cancelarBloqueado}
          esBloqueado={opcionEsBloqueado}
          setEsBloqueado={setOpcionEsBloqueado}
          precioEstrellas={opcionPrecioEstrellas}
          setPrecioEstrellas={setOpcionPrecioEstrellas}
          titulo="Editar Bloqueado de opción"
          subtitulo="Ingresa el número de ⭐ (ponga 0 para desactivar)"
        />
      )}

      {modoBloqueado === "opcionTemp" && (
        <ModalBloqueadoUnificado
          isOpen={mostrarModalBloqueado}
          onSave={guardarBloqueadoOpcionTemp}
          onCancel={cancelarBloqueado}
          esBloqueado={opcionEsBloqueado}
          setEsBloqueado={setOpcionEsBloqueado}
          precioEstrellas={opcionPrecioEstrellas}
          setPrecioEstrellas={setOpcionPrecioEstrellas}
          titulo="Configurar Bloqueado para mensaje"
          subtitulo="Ingresa el número de ⭐ (ponga 0 para desactivar)"
        />
      )}
    </>
  );

  return (
    <div className="historias-app admin-function-standalone-page">
      {renderModales()}

      <header className="historias-header">
        <div className="historias-header-left">
          <div className="historias-logo">
            <img src="/HERSc.jpg" alt="Logo" className="historias-logo-img" />
          </div>
          <h1>Mis Historias</h1>
        </div>
        <div className="historias-header-actions">
          <button
            onClick={() => setMostrarFormulario(!mostrarFormulario)}
            className="historias-btn-nueva-historia"
          >
            <FaPlus /> Nueva Historia
          </button>
          <button onClick={logout} className="historias-btn-logout">
            <FaSignOutAlt /> {embedded ? "Volver" : "Cerrar sesión"}
          </button>
        </div>
      </header>

      {mostrarFormulario && (
        <form
          onSubmit={crearHistoria}
          className="historias-form-nueva-historia"
        >
          <div className="historias-bilingue-campos historias-historia-titulos-bilingues">
            <div className="historias-bilingue-campo">
              <label>English</label>
              <input
                type="text"
                placeholder="Story title in English..."
                value={tituloEn}
                onChange={(e) => setTituloEn(e.target.value)}
                className="historias-input-titulo"
              />
            </div>
            <div className="historias-bilingue-campo">
              <label>Español</label>
              <input
                type="text"
                placeholder="Título de la historia en español..."
                value={tituloEs}
                onChange={(e) => setTituloEs(e.target.value)}
                className="historias-input-titulo"
              />
            </div>
          </div>
          <div className="historias-form-actions">
            <button type="submit" className="historias-btn-crear">
              <FaBook /> Crear
            </button>
            <button
              type="button"
              onClick={() => setMostrarFormulario(false)}
              className="historias-btn-cancelar"
            >
              <FaTimes /> Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="historias-main-content">
        <div className="historias-sidebar">
          <div className="historias-sidebar-logo">
            <img
              src="/HERSc.jpg"
              alt="Logo"
              className="historias-logo-img-small"
            />
          </div>
          <h2>Mis Historias</h2>
          {historias.length === 0 ? (
            <p className="historias-no-historias">No hay historias aún</p>
          ) : (
            <ul className="historias-lista-historias">
              {historias.map((historia) => (
                <li
                  key={historia.id}
                  className={`historias-historia-item ${historiaActual?.id === historia.id ? "historias-active" : ""}`}
                >
                  <div
                    className="historias-historia-info"
                    onClick={() => seleccionarHistoria(historia)}
                  >
                    <span className="historias-historia-titulo historias-bilingue-visual">
                      <span>
                        <strong>EN:</strong>{" "}
                        {historia.titulo_en || "(Sin título en inglés)"}
                      </span>
                      <span>
                        <strong>ES:</strong>{" "}
                        {historia.titulo_es || "(Sin título en español)"}
                      </span>
                    </span>
                  </div>
                  <div className="historias-historia-acciones">
                    <button
                      onClick={() => {
                        setEditandoHistoria(historia);
                        setEditTituloEn(
                          historia.titulo_en || historia.titulo_es || "",
                        );
                        setEditTituloEs(
                          historia.titulo_es || historia.titulo_en || "",
                        );
                        setMostrarEditorHistoria(true);
                      }}
                      className="historias-btn-editar-historia"
                      title="Editar"
                    >
                      <FaEdit />
                    </button>
                    <button
                      onClick={() =>
                        setConfirmarEliminacion({
                          tipo: "historia",
                          id: historia.id,
                          mensaje: "¿Eliminar esta historia?",
                        })
                      }
                      className="historias-btn-eliminar-historia"
                      title="Eliminar"
                    >
                      <FaTrash />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="historias-contenido-principal">
          {historiaActual ? (
            <>
              <div className="historias-historia-header">
                <div className="historias-historia-titulo-principal historias-bilingue-visual">
                  <span>
                    <strong>EN:</strong>{" "}
                    {historiaActual.titulo_en || "(Sin título en inglés)"}
                  </span>
                  <span>
                    <strong>ES:</strong>{" "}
                    {historiaActual.titulo_es || "(Sin título en español)"}
                  </span>
                </div>
                <div className="historias-historia-header-actions">
                  <span className="historias-badge-mensajes">
                    <FaFeather />{" "}
                    {
                      secuencia.filter(
                        (item) => item.tipo === "mensaje" && !item.padre_id,
                      ).length
                    }
                  </span>
                  <span className="historias-badge-opciones">
                    <FaLink />{" "}
                    {secuencia.filter((item) => item.tipo === "opcion").length}
                  </span>
                  <span className="historias-badge-archivos">
                    <FaPaperclip />{" "}
                    {Object.values(mensajesMultimedia).reduce(
                      (acc, arr) => acc + (arr?.length || 0),
                      0,
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setOpcionEditando(null);
                      setOpcionesConfig([
                        {
                          texto: "",
                          textoEs: "",
                          mensajes: [],
                          mensajeTemp: {
                            mensajeEn: "",
                            mensajeEs: "",
                            multimedia: [],
                            esBloqueado: false,
                            precioEstrellas: 0,
                          },
                          mostrarMultimedia: false,
                          expandido: true,
                        },
                      ]);
                      setMostrarFormularioOpcion(true);
                    }}
                    className="historias-btn-agregar-opcion-header"
                  >
                    <FaPlus /> Nueva opción
                  </button>
                </div>
              </div>

              <div className="historias-estadisticas-estrellas-secuencia">
                <div className="historias-estadisticas-estrellas-resumen">
                  <span className="historias-estadisticas-estrellas-total">
                    ⭐ {estadisticasCompras.totalEstrellas}
                  </span>
                  <span>⭐ gastadas en esta secuencia</span>
                  <span className="historias-estadisticas-estrellas-usuarios">
                    {estadisticasCompras.usuarios.length} usuario(s)
                  </span>
                </div>
                {estadisticasCompras.usuarios.length > 0 ? (
                  <div className="historias-estadisticas-estrellas-lista">
                    {estadisticasCompras.usuarios.map((usuario) => (
                      <span
                        key={String(usuario.userId)}
                        className="historias-estadistica-estrellas-usuario"
                      >
                        <strong>{usuario.username}</strong>: ⭐{" "}
                        {usuario.estrellas}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="historias-estadisticas-estrellas-vacio">
                    Todavía no hay desbloqueos
                  </span>
                )}
              </div>

              <MensajeForm
                mensajeEn={mensajeEn}
                setMensajeEn={setMensajeEn}
                mensajeEs={mensajeEs}
                setMensajeEs={setMensajeEs}
                multimediaSeleccionada={multimediaSeleccionada}
                setMultimediaSeleccionada={setMultimediaSeleccionada}
                onSubmit={agregarMensaje}
                cargando={guardandoMensaje}
                videosDisponibles={videosDisponibles}
                fotosDisponibles={fotosDisponibles}
                onToggleMultimedia={toggleMultimedia}
                verificarEnUso={verificarMultimediaEnUso}
                esBloqueado={formEsBloqueado}
                precioEstrellas={formPrecioEstrellas}
                onOpenBloqueado={abrirBloqueadoFormulario}
              />

              <div className="historias-panel-arbol">
                <div className="historias-panel-arbol-header">
                  <h3 className="historias-panel-arbol-titulo">
                    <FaTree /> Árbol de la historia
                  </h3>
                  <p className="historias-panel-arbol-subtitulo">
                    <span className="historias-highlight">
                      Usa los botones de subir y bajar para reordenar elementos.
                    </span>
                    <br />
                    <span className="historias-highlight">
                      Los usuarios escribirán el número o texto de la opción.
                    </span>
                    <br />
                    <span className="historias-highlight">
                      Haz clic en cualquier mensaje para ver detalles completos.
                    </span>
                  </p>
                </div>

                {cargandoHistoria ? (
                  <div className="historias-cargando-historia">
                    <FaSpinner className="historias-spin" />
                    <p>Cargando historia...</p>
                  </div>
                ) : (
                  <div className="historias-panel-arbol-contenido">
                    {renderArbol}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="historias-no-seleccionada">
              <div className="historias-no-seleccionada-content">
                <div className="historias-no-seleccionada-logo">
                  <img
                    src="/HERSc.jpg"
                    alt="Logo"
                    className="historias-logo-img"
                  />
                </div>
                <p>Selecciona una historia para comenzar</p>
                <p className="historias-no-seleccionada-sub">
                  Las historias que crees aparecerán en el panel izquierdo
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
