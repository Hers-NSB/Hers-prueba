# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Integrado en `main`. [PR #2 de AgencyKey](https://github.com/Hers-NSB/Hers-prueba/pull/2) y [PR #3 de Finanzas](https://github.com/Hers-NSB/Hers-prueba/pull/3).
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/) sirve el panel actualizado. El disparador diario de AgencyKey está configurado para las 11:00 UTC.
- Supabase de pruebas tiene aplicada la migración `20261120211652_finance_distribution_plans`. Se verificaron la importación de AgencyKey y los permisos del reparto.
- Finanzas → Empleados calcula el reparto sobre el total CRM de todos los modelos del período. Cada revisión conserva los porcentajes y su fecha de vigencia.
- Siguiente paso: configurar los porcentajes de Chatters, Modelos, Dropper y Agencia HERS desde Empleados.
