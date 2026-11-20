import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const APPLICATIONS_TABLE = "applications";
export const PHOTOS_BUCKET = "model-photos";

export async function teamLogin(username, password, expectedRole) {
  const cleanUsername = username
    ?.trim()
    .replace(/@supabase$/i, "")
    .toLowerCase();

  if (!cleanUsername || !password) {
    return { error: "Ingresa tu usuario y contraseña" };
  }

  const { data, error } = await supabase.functions.invoke("team-login", {
    body: {
      username: cleanUsername,
      password,
      role: expectedRole,
    },
  });

  if (error || !data?.session) {
    return { error: data?.error || "Usuario o contraseña incorrectos" };
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (sessionError) {
    return { error: "No se pudo establecer la sesión" };
  }

  return {
    data: { user: data.user, session: data.session },
    username: data.username || cleanUsername,
    role: data.role || expectedRole,
  };
}

export async function adminLogin(username, password) {
  return teamLogin(username, password, "admin");
}

export async function modelLogin(username, password) {
  const cleanUsername = username
    ?.trim()
    .replace(/@supabase$/i, "")
    .toLowerCase();

  if (!cleanUsername || !password) {
    return { error: "Ingresa tu usuario y contraseña" };
  }

  const { data, error } = await supabase.functions.invoke("model-login", {
    body: {
      username: cleanUsername,
      password,
    },
  });

  if (error || !data?.session) {
    return {
      error: data?.error || "Usuario o contraseña incorrectos",
    };
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (sessionError) {
    return { error: "No se pudo establecer la sesión" };
  }

  return {
    data: { user: data.user, session: data.session },
    username: data.username || cleanUsername,
  };
}

export async function adminLogout() {
  await supabase.auth.signOut();
}
