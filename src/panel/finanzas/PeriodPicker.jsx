import { useId, useState } from "react";
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

export default function PeriodPicker({ value, onChange, disabled, label = "Período de análisis" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => firstOfMonth(date(value?.from ?? today())));
  const [start, setStart] = useState(null);
  const current = today();
  const first = month.getTime() - ((month.getUTCDay() + 6) % 7) * dayMs;
  const close = () => { setOpen(false); setStart(null); };
  const select = (from, to) => { onChange({ from, to }); close(); };

  return <div className="hf-period" onKeyDown={(event) => {
    if (event.key === "Escape") { close(); event.currentTarget.querySelector("button").focus(); }
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <span id={`${id}-label`}>{label}</span>
    <button type="button" className="hf-select-trigger hf-period-trigger" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`}
      aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined} onClick={() => {
        if (open) { close(); return; }
        setMonth(firstOfMonth(date(value?.from ?? today())));
        setOpen(true);
      }}>
      <span id={`${id}-value`}>{value ? `${short.format(date(value.from))} – ${short.format(date(value.to))}` : "Todas las fechas"}</span><CalendarDays size={17} />
    </button>
    {open && <div id={`${id}-calendar`} className="hf-calendar" role="group" aria-label="Calendario del período">
      <div className="hf-calendar-presets">
        {periodPresets(current).map(([label, from, to]) => <button type="button" key={label}
          aria-pressed={value?.from === from && value.to === to} onClick={() => select(from, to)}>{label}</button>)}
      </div>
      <div className="hf-calendar-body">
        <div className="hf-calendar-month">
          {[[-12, "Año anterior", ChevronsLeft], [-1, "Mes anterior", ChevronLeft], [0], [1, "Mes siguiente", ChevronRight], [12, "Año siguiente", ChevronsRight]]
            .map(([offset, label, Icon]) => offset ? <button type="button" key={offset} aria-label={label} onClick={() => setMonth(firstOfMonth(month, offset))}><Icon size={15} /></button>
              : <strong key={offset} aria-live="polite">{monthLabel.format(month)}</strong>)}
        </div>
        <div className="hf-calendar-grid">
          {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((day) => <span key={day}>{day}</span>)}
          {Array.from({ length: 42 }, (_, index) => {
            const day = new Date(first + index * dayMs);
            const valueKey = key(day);
            const selected = start ? valueKey === start : Boolean(value && valueKey >= value.from && valueKey <= value.to);
            return <button type="button" key={valueKey} aria-label={full.format(day)} aria-pressed={selected}
              data-other={day.getUTCMonth() !== month.getUTCMonth()} disabled={valueKey > current || Boolean(start && Math.abs(day - date(start)) >= 366 * dayMs)}
              onClick={() => {
                if (!start) setStart(valueKey);
                else select(...[start, valueKey].sort());
              }}>{day.getUTCDate()}</button>;
          })}
        </div>
      </div>
      <p>{start ? "Selecciona la fecha de cierre" : "Selecciona las fechas de inicio y cierre"} · Máximo 366 días</p>
    </div>}
  </div>;
}
