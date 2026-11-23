import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export default function CategoryDescription({ name, description, children }) {
  const id = useId();
  const trigger = useRef(null);
  const tooltip = useRef(null);
  const dismissTimer = useRef(null);
  const [host, setHost] = useState(null);
  const show = (event) => {
    window.clearTimeout(dismissTimer.current);
    setHost(event.currentTarget.closest("dialog, .hf-finance"));
  };
  const deferDismiss = () => {
    window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => setHost(null), 120);
  };

  useEffect(() => () => window.clearTimeout(dismissTimer.current), []);

  useLayoutEffect(() => {
    if (!host) return;
    const anchor = trigger.current;
    const bubble = tooltip.current;
    const place = () => {
      const { left, top, bottom } = anchor.getBoundingClientRect();
      const { width, height } = bubble.getBoundingClientRect();
      const { clientWidth, clientHeight } = document.documentElement;
      const inset = 8;
      const y = bottom + inset + height <= clientHeight ? bottom + inset : top - height - inset;
      bubble.style.left = `${Math.max(inset, Math.min(left, clientWidth - width - inset))}px`;
      bubble.style.top = `${Math.max(inset, Math.min(y, clientHeight - height - inset))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    function dismiss(event) {
      if (event.type === "pointerdown") {
        if (!trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) setHost(null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setHost(null);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [host]);

  if (!description?.trim()) return children ?? name;
  return <span className="hf-category-description"
    onPointerEnter={(event) => { if (event.pointerType === "mouse") show(event); }}
    onPointerLeave={(event) => {
      if (event.pointerType === "mouse" && !trigger.current?.matches(":focus-visible")) deferDismiss();
    }}>
    {children}
    <button type="button" ref={trigger} className="hf-category-description-trigger"
      aria-label={children ? `Descripción de ${name}` : undefined} aria-describedby={id}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) show(event); }}
      onBlur={() => setHost(null)} onClick={(event) => {
        if (event.nativeEvent.pointerType === "touch" && host) setHost(null);
        else show(event);
      }}>
      {children ? <Info size={16} aria-hidden="true" /> : name}
    </button>
    {!host && <span id={id} hidden>{description}</span>}
    {host && createPortal(<span className="hf-category-tooltip" ref={tooltip} id={id} role="tooltip"
      onPointerEnter={() => window.clearTimeout(dismissTimer.current)}
      onPointerLeave={() => { if (!trigger.current?.matches(":focus-visible")) deferDismiss(); }}>{description}</span>, host)}
  </span>;
}
