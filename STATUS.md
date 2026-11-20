# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Rama `fix/agencykey-worker-redirect`. Corrige el 502 de Integraciones al usar el modo de redirección manual de Cloudflare Workers y rechazar las respuestas fuera de 2xx.
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/). El disparador diario está configurado para las 11:00 UTC.
- Integraciones permite guardar credenciales cifradas y probar o ejecutar la sincronización de AgencyKey.
- Comprobaciones: compilación de Vite, ocho pruebas de Node y validación en Supabase del acceso al RPC y de la respuesta sin secretos.
- El panel de equipo incluye el inicio de sesión. Las cuentas de administrador y sus contraseñas se gestionan desde Supabase.
- Siguiente paso: entrar con una cuenta administradora de «Hers prueba», guardar la clave de AgencyKey desde Integraciones, ejecutar **Probar conexión** y **Sincronizar ahora**, y comprobar la importación en Supabase. Sigue pendiente validar el origen público de los importes brutos y netos por modelo.
