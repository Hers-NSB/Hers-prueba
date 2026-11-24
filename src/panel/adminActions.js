import { createContext, useContext, useEffect, useLayoutEffect } from "react";

export const AdminActions = createContext(null);

export function useAdminRefresh(section, refresh) {
  const actions = useContext(AdminActions);
  const handlers = actions?.handlers;
  useLayoutEffect(() => {
    if (!handlers) return;
    handlers.set(section, refresh);
    return () => handlers.delete(section);
  }, [handlers, section, refresh]);
}

export function AdminError({ id, section, message }) {
  const setErrors = useContext(AdminActions)?.setErrors;
  useEffect(() => {
    setErrors?.((current) => {
      if (current[id]?.message === message || (!message && !current[id])) return current;
      const next = { ...current };
      if (message) next[id] = { section, message };
      else delete next[id];
      return next;
    });
  }, [id, message, section, setErrors]);
  return null;
}
