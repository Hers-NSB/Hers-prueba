# Estado de Hers-prueba

Verificado el 24 de noviembre de 2026.

## Despliegue

- [Hers-prueba](https://hers-prueba.datosenviados07.workers.dev/) se despliega con Cloudflare Builds desde `main`. El [PR #20](https://github.com/Hers-NSB/Hers-prueba/pull/20) incorporó la configuración de Wrangler para el Worker web.
- El [PR #19](https://github.com/Hers-NSB/Hers-prueba/pull/19) integró el resumen mensual en Inicio, la actualización por sección y Dropper con su Worker y D1 propios.
- La aplicación de Windows se descarga desde [GitHub Releases de Hers-prueba](https://github.com/Hers-NSB/Hers-prueba/releases). El [release de Windows](https://github.com/Hers-NSB/Hers-prueba/releases/tag/hers-dropper-8b42f44b2bbc) incluye `HERS-Dropper.exe`. Se retiraron el botón del panel y la ruta de descarga de R2.
- Supabase de pruebas tiene aplicadas las migraciones hasta `20261123174135_finance_overview_totals`.
- La importación de AgencyKey se ejecuta con el disparador `5,20,35,50 * * * *` en UTC. El cierre usa la zona de reporte `America/Halifax`.

## Cambios publicados en el PR #16

- Resultado operativo muestra las ventas netas diarias antes del reparto como Ingreso y la inversión como segunda serie. El 23 de noviembre la serie de Ingreso toma $110,40 y lo muestra como $110. Pasaron GitHub Actions, la prueba de regresión y la comparación de los recursos publicados con el build.

## Cambios publicados en el PR #15

- La portada carga el panel administrativo y sus secciones según se abren. Se retiraron el panel de Historias, sus estilos, su imagen y sus accesos.
- Finanzas consulta ventas y movimientos del rango en Supabase. La bóveda usa `finance_overview_totals`, Movimiento muestra 50 filas por página y cada corte carga su movimiento vinculado.
- Se retiró el importador anterior de AgencyKey. GitHub Actions ejecuta las integraciones SQL y `cloudflare/deploy.json` registra el cron, las rutas y los bindings del Worker.
- GitHub Actions pasó. La portada y los recursos publicados coincidieron con el build. Se verificaron las respuestas 401 de Conectores sin sesión, 410 de la ruta retirada y 404 del recurso retirado de Historias. La consulta de la bóveda respondió en Supabase de pruebas con el rol de administrador. Se comprobó el panel de Finanzas con datos simulados.

## Finanzas y Conectores

- **Empleados** muestra las ventas netas de la quincena en las tablas **Modelos** y **Otros empleados**. Los chatters desactivados conservan su historial y los importes que les correspondan según las ventas y la vigencia del porcentaje.
- **Pagos** muestra las ventas acumuladas, el pago estimado y los días importados. Los cambios de porcentaje hechos desde la interfaz rigen toda la quincena actual. Los cortes cerrados y las vigencias existentes fuera de la operación se conservan.
- El cierre quincenal genera automáticamente los cortes. Cuando se confirma un pago, se registra una sola inversión en **Equipo** para empleados o en **Modelo** para modelos.
- El avance verificado de la quincena del 16 al 30 de noviembre es de 7 de 15 días importados. La base tiene 0 cortes registrados. La comprobación de un pago real queda pendiente del primer cierre.
- Se validaron el cierre y la confirmación con pruebas SQL, además de la interfaz de escritorio y móvil con datos simulados.

## Postulaciones

El formulario de pruebas guarda en Supabase y muestra la confirmación al enviar. Se verificaron el envío anónimo y el acceso administrativo con una prueba SQL que revierte sus datos. [PR #7](https://github.com/Hers-NSB/Hers-prueba/pull/7).


## Registro de cambios

### 23 de noviembre de 2026 · Dropper en Administración

La rama `codex/dropper-en-hers` agrega el resumen, los ajustes y la descarga de Windows en **Dropper**. **Conectores → Bots** usa las herramientas de configuración y verificación del Worker de Dropper. Los datos permanecen en D1. Pasaron las 28 pruebas de Node, el lint y la compilación. Chromium comprobó la recarga y ambas vistas a 390 px con los dos Workers y D1 local. Ambos Workers y [HERS Dropper para Windows](https://github.com/Hers-NSB/Dropper/releases/tag/recorder-58-1) se publicaron el 24 de noviembre.

### 23 de noviembre de 2026 · Carga de Administración

La rama `codex/carga-panel-administracion` muestra una pantalla de carga durante la restauración de sesión y la descarga del panel. Postulaciones, Finanzas y Conectores comparten un indicador de carga que respeta la preferencia de movimiento reducido. Pasaron el lint, la compilación, las 26 pruebas de Node y la regresión de sesión y carga de Conectores en un DOM simulado. Publicado el 24 de noviembre.

### 23 de noviembre de 2026 · Importes del gráfico

Resultado operativo muestra Ingreso e Inversión en dólares enteros, con el mismo estilo en todas las fechas. Chromium comprobó el tooltip y el ancho del gráfico a 320, 768 y 1440 px. GitHub Actions pasó y los recursos publicados coinciden con el build.

### 23 de noviembre de 2026 · Pagos en dólares enteros

La migración `20261123161750_finance_whole_pay_current_period.sql` aplica desde el inicio de la quincena en curso el último porcentaje guardado para cada participante. La estimación y los cierres nuevos redondean el pago total al dólar más cercano. En Supabase de pruebas, SMELL tiene $209,16 en ventas atribuidas y un pago estimado de $21 con el 10 % desde el día 16.

La etiqueta Inactivo aparece también al abrir Pagos. El botón Eliminar de los empleados manuales abre desde Pagos la confirmación que archiva al empleado y conserva su historial. Pasaron GitHub Actions y las dos integraciones SQL de pagos contra Supabase de pruebas. El archivado y la etiqueta se verificaron en Chromium a 320, 768 y 1440 px con un servidor simulado.

### 23 de noviembre de 2026 · Despliegue de Finanzas

Se publicaron el gráfico de áreas y los reintentos. El gráfico conserva todas las fechas del rango. Pagos conserva la edición en línea del porcentaje y el botón Editar para empleados manuales.

Pasaron GitHub Actions, 28 pruebas de Node y cinco integraciones SQL locales. En Supabase de pruebas pasaron las dos integraciones de pagos, mediante transacciones revertidas. En Cloudflare se compararon la portada y los nueve recursos con el build, y se comprobaron las respuestas 401 de Conectores sin sesión y 410 de la ruta retirada. Cloudflare conserva el disparador, los registros, las trazas y la redacción de parámetros.

### 23 de noviembre de 2026 · Reintentos de AgencyKey

- `cloudflare/worker.js` reintenta la consulta puntual de transacciones ante 502, 503 y 504. Ante 429 respeta las esperas de hasta diez segundos y devuelve al cliente las mayores. Finanzas detiene el lote si recibe un 429.
- Si una consulta de transacciones agota los intentos, no se guarda un día parcial. El disparador prueba el siguiente día pendiente de la misma quincena y vuelve a buscar el día más antiguo en el siguiente ciclo.
- `20261123155240_finance_next_pending_import.sql` habilita la búsqueda del siguiente día pendiente sin marcar fechas como importadas. Migración aplicada en Supabase y Worker publicado en Cloudflare.

### 23 de noviembre de 2026 · Actualización, gráfico y pagos

Rama `codex/finanzas-actualizacion-y-pagos`. Supabase registró entre 370 y 391 respuestas exitosas por operación de lectura frecuente de Finanzas en 24 horas. La consulta de registros no devolvió respuestas 429 en esas rutas. Las trazas de Cloudflare y Supabase confirmaron un 502 de transacciones en AgencyKey, otro intento con neto sin confirmar y dos fallos del directorio con SQLSTATE 21000. Supabase ya tiene la actualización del directorio acotada a la revisión de la conexión.

- `src/panel/finanzas/finanzas.jsx` actualiza únicamente el cálculo de la quincena en segundo plano mientras Empleados está visible. Las lecturas cancelables se descartan al cambiar de contexto. La sincronización manual reutiliza los días completos, vuelve a pedir el día actual si está en el período y corta el lote si recibe HTTP 429.
- `src/panel/finanzas/FinanceCharts.jsx` y `finanzas.css` muestran Ingreso e Inversión como áreas adaptables, aumentan el contraste y ocultan los controles visuales de incremento en los importes y porcentajes.
- Movimiento muestra su propia descripción al consultar la categoría de la fila. El panel Categorías muestra la descripción del catálogo. Pagos conserva el acceso a Editar para los empleados manuales y muestra centavos.
- `supabase/migrations/20261123043232_finance_inactive_chatter_pay.sql` conserva la comisión de los chatters inactivos cuando AgencyKey atribuye ventas en fechas con porcentaje vigente. La misma regla se usa para el estimado y los próximos cierres.
- Las 25 pruebas de Node y las 5 integraciones SQL locales pasaron. La regresión de chatter inactivo falla con las migraciones anteriores y pasa con la nueva. Chromium comprobó a 320, 768 y 1440 px el ancho del gráfico, los tooltips, los campos numéricos, la edición desde Pagos y la consulta única de pagos al volver a la pestaña. El despliegue actual se registra en **Despliegue**.

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
