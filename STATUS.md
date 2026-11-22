# Estado de Hers-prueba

Verificado el 21 de noviembre de 2026.

## Finanzas

- El [PR #9](https://github.com/Hers-NSB/Hers-prueba/pull/9) se integró en `main` en el commit `5c47d33`. Incluye los ajustes de Resumen, Movimiento y Empleados.
- El [Worker de HERS prueba](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 21 al 100 % del tráfico. Está configurado el disparador `5,20,35,50 * * * *` y Supabase de pruebas tiene aplicada la migración `20261122003428_finance_pay_periods`.
- Los cortes se guardan en el historial individual. Confirmar un pago positivo registra una inversión vinculada por el mismo importe en la fecha de confirmación.
- Pasaron GitHub Actions y la prueba SQL de cierre, confirmación y permisos con reversión en Supabase de pruebas. Se verificaron Finanzas y la consulta de ventas de AgencyKey desde el panel publicado.
- La autorización del directorio queda disponible en **Conectores → Autorizar directorio de AgencyKey**. Usa una cuenta con acceso al equipo completo cuando quieras activarla.

## Postulaciones

- El [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7) está integrado. El formulario guarda en Supabase y muestra la confirmación en pantalla.
- Supabase de pruebas tiene aplicada la migración `20261121154801_applications`. Se verificaron el envío anónimo y el acceso administrativo con una prueba SQL que revirtió sus cambios.
