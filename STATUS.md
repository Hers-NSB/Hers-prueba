# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Integrado en `main`. [PR #2 de AgencyKey](https://github.com/Hers-NSB/Hers-prueba/pull/2) y [PR #3 de Finanzas](https://github.com/Hers-NSB/Hers-prueba/pull/3).
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/) sirve el panel actualizado. El disparador diario de AgencyKey está configurado para las 11:00 UTC.
- Supabase de pruebas tiene aplicada la migración `20261120211652_finance_distribution_plans`. Se verificaron la importación de AgencyKey y los permisos del reparto.
- Rama `feat/finanzas-neto-agencykey`. Resumen y Empleados usan el importe neto registrado y se retiró la tabla de ventas importadas del Resumen.
- Pendiente para publicar: conectar el Worker con una fuente de neto compatible con su credencial. Los reportes públicos de rendimiento actuales devuelven `totalSalesSum`. El conector de AgencyKey sí devuelve `net` en el reporte de ingresos.
