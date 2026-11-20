# Estado de Hers-prueba

Entorno web de pruebas de HERS. Fecha de verificación: 2026-11-20.

- [PR #5](https://github.com/Hers-NSB/Hers-prueba/pull/5) integrado en `main`. Finanzas incluye calendario de rango, categorías, gestión de empleados, reparto y bóveda. El menú principal muestra Conectores.
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 15 del Worker. Se retiró el disparador diario tras verificar **Finanzas → Actualizar** en el sitio activo.
- Supabase de pruebas tiene registrada la migración `20261120223500_finance_manual_updates`. La actualización manual del 19 de noviembre guardó el neto de cinco modelos por un total de USD 36,00. El panel mostró ese importe en Ventas netas y en la bóveda de Agencia HERS.
- Pasaron ESLint, las 16 pruebas y la compilación. Postulaciones queda para una actualización posterior.
