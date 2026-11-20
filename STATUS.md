# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- [PR #3](https://github.com/Hers-NSB/Hers-prueba/pull/3), rama `feat/finanzas-dashboard`. El resumen de Finanzas está desplegado en pruebas. El PR incorpora también la paleta del panel, formularios centrados y la reorganización de Integraciones y Empleados.
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/). El disparador diario está configurado para las 11:00 UTC.
- AgencyKey verificado en Cloudflare de pruebas. Supabase recibió 5 registros por modelo y 10 atribuciones del 19 de noviembre de 2026. El arreglo del Worker está en el [PR #2](https://github.com/Hers-NSB/Hers-prueba/pull/2).
- El panel de equipo incluye el inicio de sesión. Las cuentas de administrador y sus contraseñas se gestionan desde Supabase.
- Siguiente paso: definir la base de cálculo y la regla de reparto entre Chatters, Modelos, Dropper y HERS. Los porcentajes vigentes de chatter se pueden gestionar desde Empleados.
