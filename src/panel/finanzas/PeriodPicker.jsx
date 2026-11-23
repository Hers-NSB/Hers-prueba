import { useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { periodPresets } from "./finance";

const date = (value) => new Date(value + "T00:00:00Z");
const key = (day) => day.toISOString().slice(0, 10);
const dayMs = 86_400_000;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Caracas", dateStyle: "short" }).format(new Date());
const short = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const full = new Intl.DateTimeFormat("es", { dateStyle: "full", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" });
const firstOfMonth = (value, offset = 0) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));

export default function PeriodPicker({ value, onChange, disabled, label = "Período de análisis", single = false, allowFuture = false }) {
  const id = useId();
  const trigger = useRef(null);
  const current = today();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => firstOfMonth(date(value.from || current)));
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const first = month.getTime() - ((month.getUTCDay() + 6) % 7) * dayMs;
  const close = () => { setOpen(false); setStart(null); setEnd(null); };
  const select = (from, to) => { trigger.current.focus(); onChange({ from, to }); close(); };
  const [lower, upper] = start
    ? [start, end || start].sort()
    : [value.from, single ? value.from : value.to];
  const display = value.from && short.format(date(value.from));
  const description = single || !value.to ? display : `${display} – ${short.format(date(value.to))}`;

  return <div className="hf-period" onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      trigger.current.focus();
      close();
    }
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <span id={`${id}-label`}>{label}</span>
    <button type="button" ref={trigger} className="hf-select-trigger hf-period-trigger" disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined}
      onClick={() => {
        if (open) { close(); return; }
        setMonth(firstOfMonth(date(value.from || current)));
        setOpen(true);
      }}>
      <span id={`${id}-value`}>{description || (single ? "Seleccionar fecha" : "Todas las fechas")}</span>
      <CalendarDays size={17} aria-hidden="true" />
    </button>
    {open && <div id={`${id}-calendar`} className="hf-calendar" data-single={single} role="group" aria-label={label}>
      {!single && <div className="hf-calendar-presets">
        {periodPresets(current).map(([preset, from, to]) => <button type="button" key={preset}
          aria-pressed={value.from === from && value.to === to} onClick={() => select(from, to)}>{preset}</button>)}
      </div>}
      <div className="hf-calendar-body">
        <div className="hf-calendar-month">
          {[[-12, "Año anterior", ChevronsLeft], [-1, "Mes anterior", ChevronLeft], [0], [1, "Mes siguiente", ChevronRight], [12, "Año siguiente", ChevronsRight]]
            .map(([offset, name, Icon]) => offset ? <button type="button" key={offset} aria-label={name} onClick={() => setMonth(firstOfMonth(month, offset))}><Icon size={15} /></button>
              : <strong key={offset} aria-live="polite">{monthLabel.format(month)}</strong>)}
        </div>
        <div className="hf-calendar-grid">
          {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((day) => <span key={day}>{day}</span>)}
          {Array.from({ length: 42 }, (_, index) => {
            const day = new Date(first + index * dayMs);
            const valueKey = key(day);
            const selected = valueKey >= lower && valueKey <= upper;
            const boundary = valueKey === lower || valueKey === upper;
            const unavailable = !allowFuture && valueKey > current || Boolean(start && Math.abs(day - date(start)) >= 366 * dayMs);
            return <button type="button" key={valueKey} aria-label={full.format(day)} aria-pressed={selected}
              data-boundary={boundary} data-other={day.getUTCMonth() !== month.getUTCMonth()} disabled={unavailable}
              onPointerEnter={() => { if (start && !unavailable) setEnd(valueKey); }}
              onFocus={() => { if (start) setEnd(valueKey); }}
              onClick={() => {
                if (single) select(valueKey);
                else if (start) select(...[start, valueKey].sort());
                else setStart(valueKey);
              }}>{day.getUTCDate()}</button>;
          })}
        </div>
      </div>
      {!single && <p>{start ? "Selecciona la fecha de cierre" : "Selecciona las fechas de inicio y cierre"} · Máximo 366 días</p>}
    </div>}
  </div>;
}
