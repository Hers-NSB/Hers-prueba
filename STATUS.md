# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Integrado en `main`. [PR #2 de AgencyKey](https://github.com/Hers-NSB/Hers-prueba/pull/2) y [PR #3 de Finanzas](https://github.com/Hers-NSB/Hers-prueba/pull/3).
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/) sirve el panel actualizado. El disparador diario de AgencyKey está configurado para las 11:00 UTC.
- Supabase de pruebas tiene aplicada la migración `20261120211652_finance_distribution_plans`. Se verificaron la importación de AgencyKey y los permisos del reparto.
- [PR #5](https://github.com/Hers-NSB/Hers-prueba/pull/5). Finanzas usa ventas netas, actualización manual, calendario de rango, categorías, gestión de empleados y bóveda de Agencia HERS. El menú muestra Conectores. CI ejecuta ESLint 10.
- Antes del despliegue, verificar el permiso de ingresos del proxy de AgencyKey con la credencial del Worker, aplicar la migración `finance_manual_updates` al entorno de prueba y retirar el disparador diario al activar la versión nueva.
