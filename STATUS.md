# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Rama `feat/finanzas-dashboard`. Rediseña el Resumen de Finanzas con gráficos diarios y desgloses por modelo y plataforma.
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/). El disparador diario está configurado para las 11:00 UTC.
- AgencyKey verificado en Cloudflare de pruebas. Supabase recibió 5 registros por modelo y 10 atribuciones del 19 de noviembre de 2026. El arreglo del Worker está en el [PR #2](https://github.com/Hers-NSB/Hers-prueba/pull/2).
- El panel de equipo incluye el inicio de sesión. Las cuentas de administrador y sus contraseñas se gestionan desde Supabase.
- Siguiente paso: revisar el PR de Finanzas en escritorio y móvil. El total del reporte CRM se muestra por separado de las ventas brutas y netas registradas.
