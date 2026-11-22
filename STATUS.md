# Estado de Hers-prueba

Verificado el 21 de noviembre de 2026.

## Finanzas

- El [PR #9](https://github.com/Hers-NSB/Hers-prueba/pull/9) está integrado en `main` desde el commit `5c47d33`.
- El [Worker de HERS prueba](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 21 al 100 % del tráfico. Supabase de pruebas registra la migración `20261122003428_finance_pay_periods`.
- Cloudflare tiene activo el disparador `5,20,35,50 * * * *` (UTC). El primer período incorporado comienza el 16 de noviembre. La primera importación automática quedaba pendiente de verificar.
- Pasaron GitHub Actions y la prueba SQL de cierre, permisos y confirmación sin duplicados, con reversión en Supabase de pruebas. Se verificaron el panel publicado y la consulta de ventas de AgencyKey desde **Conectores**.
- El directorio queda disponible para activación manual desde **Conectores → Autorizar directorio de AgencyKey**.

## Postulaciones

- El [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7) está integrado. El formulario guarda en Supabase y muestra la confirmación en pantalla.
- Supabase de pruebas tiene aplicada la migración `20261121154801_applications`. Se verificaron el envío anónimo y el acceso administrativo con una prueba SQL que revirtió sus cambios.
