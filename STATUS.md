# Estado de Hers-prueba

Verificado el 21 de noviembre de 2026.

- El [PR #8](https://github.com/Hers-NSB/Hers-prueba/pull/8) se integró en `main` en el commit `9e5094f`. Finanzas incluye Resumen, Movimiento y Empleados. Los chatters vinculados cobran un porcentaje de sus ventas netas atribuidas en todas las cuentas de AgencyKey.
- El [Worker de HERS prueba](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 20 al 100 % del tráfico. Se verificaron la portada, los recursos estáticos y la protección de la ruta de sincronización.
- Supabase de pruebas tiene aplicadas las migraciones `20261121223206_finance_movements_model_shares`, `20261121223243_finance_agencykey_directory` y `20261121231332_finance_chatter_sales`.
- Pasaron ESLint, la compilación, 23 pruebas de JavaScript y la prueba de integración SQL con reversión. La versión 20 también pasó la consulta de prueba a AgencyKey.

## Postulaciones

- El [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7) está integrado. El formulario guarda en Supabase y muestra la confirmación en pantalla.
- Supabase de pruebas tiene aplicada la migración `20261121154801_applications`. Se verificaron el envío anónimo y el acceso administrativo a las postulaciones y sus fotos con una prueba SQL que revirtió sus datos.

## Directorio de AgencyKey

- La autorización inicial del directorio OAuth sigue pendiente. Abre **Finanzas → Empleados → Conectar directorio de AgencyKey** y autoriza una cuenta con acceso al equipo completo para verificar altas, bajas y roles.
- Para consultar el reparto de chatters ya vinculados, guarda su porcentaje y vigencia en **Empleados**. Elige el período en **Resumen** y pulsa **Actualizar** para importar sus ventas atribuidas.

## Finanzas y pagos quincenales en revisión

- Rama `codex/finanzas-pagos-quincenales`. Actualiza Resumen, Movimiento, Empleados y Conectores. Cada corte queda en el historial individual. Confirmar un pago positivo crea una inversión vinculada por el mismo importe y protege sus datos contables.
- Pasaron ESLint, la compilación, 23 pruebas JavaScript y cuatro pruebas de integración SQL sobre una base local aislada. El flujo de interfaz pasó en Chromium a 360, 768 y 1280 px con datos de prueba.
- Tras integrar la rama, aplica la migración de pagos a Supabase de pruebas, publica el Worker `hers-prueba`, configura `5,20,35,50 * * * *` y autoriza el directorio desde Conectores.
