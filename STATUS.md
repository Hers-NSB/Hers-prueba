# Estado de Hers-prueba

Verificado el 22 de noviembre de 2026, hora de la sesión.

## Despliegue

- [Hers-prueba](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 27 de Cloudflare Workers al 100 % del tráfico. El código funcional desplegado corresponde al commit `78198dd` del [PR #11](https://github.com/Hers-NSB/Hers-prueba/pull/11).
- Supabase de pruebas tiene aplicadas todas las migraciones del repositorio, hasta `20261123021955_finance_directory_inactive_chatters`.
- La importación de AgencyKey se ejecuta con el disparador `5,20,35,50 * * * *` en UTC. El cierre usa la zona de reporte `America/Halifax`.

## Finanzas y Conectores

- **Empleados** muestra las ventas netas de la quincena por modelo y chatter. La tabla principal incluye los chatters desactivados con la etiqueta **Inactivo** y acceso a su historial. Se verificaron dos chatters activos y uno inactivo.
- **Pagos** muestra las ventas acumuladas, el pago estimado y los días importados. El pago aplica directamente el porcentaje vigente en cada fecha de venta. Para la quincena actual, los porcentajes acordados están vigentes desde el 16 de noviembre.
- El cierre quincenal genera automáticamente los cortes. Cuando se confirma un pago, se registra una sola inversión en **Equipo** para empleados o en **Modelo** para modelos.
- El avance verificado de la quincena del 16 al 30 de noviembre es de 6 de 15 días importados. La base tiene 0 cortes registrados. La comprobación de un pago real queda pendiente del primer cierre.
- Se validaron el cierre y la confirmación con pruebas SQL, además de la interfaz de escritorio y móvil con datos simulados.

## Postulaciones

El formulario de pruebas guarda en Supabase y muestra la confirmación al enviar. Se verificaron el envío anónimo y el acceso administrativo con una prueba SQL que revierte sus datos. [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7).
