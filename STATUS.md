# Estado de Hers-prueba

Verificado el 22 de noviembre de 2026, hora de la sesión.

## Despliegue

- [Hers-prueba](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión **28** de Cloudflare Workers al **100 %** del tráfico. Código publicado `2ad510f` del [PR #12](https://github.com/Hers-NSB/Hers-prueba/pull/12), versión `29e31377-18cb-4bb5-86e5-9ec02cf54962`.
- Supabase de pruebas tiene aplicadas todas las migraciones del repositorio, hasta `20261123033155_finance_current_period_and_categories`. El identificador en el historial de migraciones coincide con el archivo del repositorio.
- La importación de AgencyKey se ejecuta con el disparador `5,20,35,50 * * * *` en UTC. El cierre usa la zona de reporte `America/Halifax`.

## Finanzas y Conectores

- **Empleados** muestra las ventas netas de la quincena en las tablas **Modelos** y **Otros empleados**. Los chatters desactivados conservan su historial y los importes que les correspondan según las ventas y la vigencia del porcentaje.
- **Pagos** muestra las ventas acumuladas, el pago estimado y los días importados. Los cambios de porcentaje hechos desde la interfaz rigen toda la quincena actual. Los cortes cerrados y las vigencias existentes fuera de la operación se conservan.
- El cierre quincenal genera automáticamente los cortes. Cuando se confirma un pago, se registra una sola inversión en **Equipo** para empleados o en **Modelo** para modelos.
- El avance verificado de la quincena del 16 al 30 de noviembre es de 6 de 15 días importados. La base tiene 0 cortes registrados. La comprobación de un pago real queda pendiente del primer cierre.
- Se validaron el cierre y la confirmación con pruebas SQL, además de la interfaz de escritorio y móvil con datos simulados.

## Postulaciones

El formulario de pruebas guarda en Supabase y muestra la confirmación al enviar. Se verificaron el envío anónimo y el acceso administrativo con una prueba SQL que revierte sus datos. [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7).


## Registro de cambios

### 23 de noviembre de 2026 · Reintentos de AgencyKey

- `cloudflare/worker.js` reintenta la consulta puntual de transacciones ante 502, 503 y 504. Ante 429 respeta las esperas de hasta diez segundos y devuelve al cliente las mayores. Finanzas detiene el lote si recibe un 429.
- Si una consulta de transacciones agota los intentos, no se guarda un día parcial. El disparador prueba el siguiente día pendiente de la misma quincena y vuelve a buscar el día más antiguo en el siguiente ciclo.
- `20261123155240_finance_next_pending_import.sql` habilita la búsqueda del siguiente día pendiente sin marcar fechas como importadas. Despliegue pendiente en Cloudflare y Supabase de pruebas.

### 23 de noviembre de 2026 · Actualización, gráfico y pagos

Rama `codex/finanzas-actualizacion-y-pagos`. Supabase registró entre 370 y 391 respuestas exitosas por operación de lectura frecuente de Finanzas en 24 horas. La consulta de registros no devolvió respuestas 429 en esas rutas. Las trazas de Cloudflare y Supabase confirmaron un 502 de transacciones en AgencyKey, otro intento con neto sin confirmar y dos fallos del directorio con SQLSTATE 21000. Supabase ya tiene la actualización del directorio acotada a la revisión de la conexión.

- `src/panel/finanzas/finanzas.jsx` actualiza únicamente el cálculo de la quincena en segundo plano mientras Empleados está visible. Las lecturas cancelables se descartan al cambiar de contexto. La sincronización manual reutiliza los días completos, vuelve a pedir el día actual si está en el período y corta el lote si recibe HTTP 429.
- `src/panel/finanzas/FinanceCharts.jsx` y `finanzas.css` muestran Ingreso e Inversión como áreas adaptables, aumentan el contraste y ocultan los controles visuales de incremento en los importes y porcentajes.
- Movimiento muestra su propia descripción al consultar la categoría de la fila. El panel Categorías muestra la descripción del catálogo. Pagos conserva el acceso a Editar para los empleados manuales y muestra centavos.
- `supabase/migrations/20261123043232_finance_inactive_chatter_pay.sql` conserva la comisión de los chatters inactivos cuando AgencyKey atribuye ventas en fechas con porcentaje vigente. La misma regla se usa para el estimado y los próximos cierres.
- Las 25 pruebas de Node y las 5 integraciones SQL locales pasaron. La regresión de chatter inactivo falla con las migraciones anteriores y pasa con la nueva. Chromium comprobó a 320, 768 y 1440 px el ancho del gráfico, los tooltips, los campos numéricos, la edición desde Pagos y la consulta única de pagos al volver a la pestaña. El despliegue de Cloudflare y la migración del proyecto conectado quedan pendientes.

### 22 de noviembre de 2026 · Finanzas

Rama `codex/finanzas-resumen-movimientos-empleados`, basada en `12eaee7`. [PR #12](https://github.com/Hers-NSB/Hers-prueba/pull/12). La versión 28 sucedió a la versión 27, que servía el commit `78198dd` del [PR #11](https://github.com/Hers-NSB/Hers-prueba/pull/11).

| Archivo | Cambio |
|---|---|
| `src/panel/AdminPanel.jsx` | Nombre accesible para abrir Finanzas cuando la navegación solo muestra iconos. |
| `src/panel/finanzas/finance.js` | Agrupación consistente de desgloses con modelo o plataforma ausente. |
| `src/panel/finanzas/FinanceCharts.jsx` | Barras sin desplazamiento horizontal, etiquetas adaptadas al ancho e ingreso máximo destacado. |
| `src/panel/finanzas/finanzas.jsx` y `finanzas.css` | Foco de teclado, adaptación de formularios y tablas, etiqueta Otros, descripción de movimiento multilínea, filtro de fechas, tablas de empleados y acceso a Editar desde Pagos. |
| `src/panel/finanzas/CategoryPicker.jsx` y `CategoryDescription.jsx` | Crear y Guardar, edición de la descripción real de categoría y consulta mediante ratón, teclado o toque. |
| `src/panel/finanzas/PaymentHistory.jsx` | Edición dentro del flujo de Pagos y filtro del historial por fechas. |
| `supabase/migrations/20261123033155_finance_current_period_and_categories.sql` | Campo de descripción, guardado de porcentajes para toda la quincena actual y cálculo de ventas y pagos para asignaciones de modelos. |
| `test/finance_current_period.integration.sql` | Pruebas de permisos, cálculo de pagos, vigencias y persistencia de descripciones. |
| `README.md` y `STATUS.md` | Documentación de uso, alcance, validaciones y continuidad. |

El servidor usa la zona de reporte de AgencyKey para determinar la quincena actual. Guardar un porcentaje actualiza desde el inicio de esa quincena y alinea cualquier vigencia posterior dentro del mismo corte. Las vigencias de otros cortes y los pagos históricos guardados se conservan. La quincena en curso y el cierre comparten el cálculo de pagos por modelos asignados. El cálculo suma cada modelo y fecha una sola vez por empleado y conserva la base de ventas atribuidas para chatters. Las categorías sin descripción quedan vacías hasta que se editen.

El total de días ya se calculaba con fechas inclusivas del período. Cada día de importación definitiva aparece una sola vez en `hers_private.finance_final_days`. Se comprobó en Supabase de pruebas que la quincena del 16 al 30 de noviembre tiene 6 de 15 días importados y que el empleado asignado manualmente tiene 35 registros de venta únicos por fecha y modelo. La segunda quincena da 13 días en febrero común, 14 en febrero bisiesto, 15 en un mes de 30 días y 16 en uno de 31.

### Verificaciones y pendientes

- Pasaron `npm run lint`, `npm run build` y las 25 pruebas de `npm test`. Vite emitió un aviso de tamaño de paquete. El proyecto carece de un comando separado de comprobación de tipos.
- Chromium comprobó a 320, 768 y 1440 px el gráfico y el foco, los tooltips, Movimiento, las dos tablas y el acceso a Editar desde Pagos. A 320 px también comprobó 366 fechas de gráfico sin desplazamiento horizontal. La sesión de navegador interceptó las llamadas a Supabase y al Worker para probar la interfaz sin modificar el entorno conectado. No se registraron errores de consola en esos recorridos.
- Las migraciones y los cinco archivos SQL de integración pasaron en PostgreSQL local mediante PGlite, con roles y funciones de sesión de prueba. Incluyen un cierre, la confirmación idempotente, chatters inactivos, asignaciones manuales, porcentajes y el historial.
- La prueba `test/finance_current_period.integration.sql` pasó en Supabase de pruebas tras aplicar la migración. La consulta de la quincena devolvió ventas y pago estimado para un empleado asignado manualmente. El chatter desactivado conserva ventas atribuidas del 16 al 18 de noviembre. Su primera vigencia empieza el 22, de modo que esas ventas no generan un pago estimado con la configuración existente.
- Cloudflare confirmó la versión 28 al 100 %, la redacción de cadenas de consulta y el disparador de importación. El sitio público entregó el HTML, los estilos y los módulos JavaScript del build publicado. Conectores devolvió 401 sin sesión y la ruta retirada de cambio de contraseña conservó la respuesta 410.
- La quincena del 16 al 30 de noviembre sigue abierta con 6 de 15 días importados y 0 cortes. La comprobación diaria del primer pago se desactivó a solicitud del usuario. La verificación queda pendiente hasta que se registre un pago real.

## CONTEXTO PARA CONTINUAR EN UN NUEVO CHAT

Hers-prueba es el entorno de pruebas del panel de administración y la portada de HERS. Usa Node.js 24, React, Vite, Recharts y Supabase. Cloudflare Workers sirve los recursos y conecta la importación diaria con AgencyKey. La configuración de entorno está descrita en [README.md](README.md).

1. Revisa el PR y compara la versión del Worker con la última migración aplicada en **Despliegue**.
2. Para continuar con la interfaz, empieza en `src/panel/finanzas/finanzas.jsx`, `FinanceCharts.jsx`, `PaymentHistory.jsx` y `finanzas.css`. El reparto de Resumen se calcula en `distribution.js`.
3. Para continuar con ventas, porcentajes o pagos, revisa la migración del 23 de noviembre en UTC junto con `20261122203513_finance_payment_details.sql`, `20261123015138_finance_current_pay_independent_sales.sql` y `cloudflare/integrations.js`. Guarda las ventas y los porcentajes históricos con el corte e importa días usando la zona de AgencyKey.
4. Cuando se registre el primer pago real, verifica que tenga una sola inversión vinculada por `finance_payment_id`, con el mismo importe y la categoría correspondiente. Para repetir la prueba de integración en Supabase de pruebas, ejecuta `test/finance_current_period.integration.sql`.
5. Al terminar cada conjunto de cambios, actualiza este archivo y revisa el README.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm test
```

Para ejecutar la aplicación configura `.env.local` según el README. Los archivos `test/*.integration.sql` contienen transacciones de prueba que revierten sus cambios.
