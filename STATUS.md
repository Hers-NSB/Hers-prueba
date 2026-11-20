# Estado de Hers-prueba

Entorno web de pruebas de HERS con un panel de Finanzas para la administración.

- Fecha: 2026-11-20.
- Rama: `finanzas-pruebas`.
- Cloudflare: [HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/). El sitio carga y el trigger diario está configurado para las 11:00 UTC.
- Compilación de Vite y cinco pruebas de Node verificadas. En Supabase «Hers prueba», el SQL de integración verificó permisos, vigencia de comisiones, movimientos manuales e importación repetida.
- La sincronización requiere los secretos `AGENCYKEY_API_KEY` y `SUPABASE_SYNC_KEY` en Cloudflare. Falta validar el origen público de los importes brutos y netos de plataforma por modelo.
- Para probar el panel con una sesión real, hace falta un usuario de Supabase «Hers prueba» con `app_metadata.role=admin`.
