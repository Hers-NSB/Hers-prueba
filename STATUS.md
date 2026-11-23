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


## Registro de cambios

### 22 de noviembre de 2026 · Finanzas

Rama `codex/finanzas-resumen-movimientos-empleados`, basada en `12eaee7`. Los cambios de este registro están preparados en GitHub. La sección **Despliegue** describe la versión publicada antes de este conjunto.

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
- Pendiente aplicar la migración y publicar el nuevo frontend en el entorno de pruebas. Queda por comprobar allí el primer pago real tras un cierre.

## CONTEXTO PARA CONTINUAR EN UN NUEVO CHAT

Hers-prueba es el entorno de pruebas del panel de administración y la portada de HERS. Usa Node.js 24, React, Vite, Recharts y Supabase. Cloudflare Workers sirve los recursos y conecta la importación diaria con AgencyKey. La configuración de entorno está descrita en [README.md](README.md).

1. Revisa la rama de Finanzas, el estado del PR y la versión publicada antes de seguir. El Worker desplegado y el proyecto de Supabase todavía corresponden al estado registrado en **Despliegue**.
2. Para continuar con la interfaz, empieza en `src/panel/finanzas/finanzas.jsx`, `FinanceCharts.jsx`, `PaymentHistory.jsx` y `finanzas.css`. El reparto de Resumen se calcula en `distribution.js`.
3. Para continuar con ventas, porcentajes o pagos, revisa la migración del 23 de noviembre en UTC junto con `20261122203513_finance_payment_details.sql`, `20261123015138_finance_current_pay_independent_sales.sql` y `cloudflare/integrations.js`. Guarda las ventas y los porcentajes históricos con el corte e importa días usando la zona de AgencyKey.
4. Sigue con la aplicación de la migración al entorno de pruebas antes de publicar la interfaz. Ejecuta `test/finance_current_period.integration.sql` y verifica allí una categoría real, el empleado asignado manualmente y un chatter desactivado. Conserva pendiente la comprobación del primer pago real hasta que se registre un corte.
5. Al terminar cada conjunto de cambios, actualiza este archivo y revisa el README.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm test
```

Para ejecutar la aplicación configura `.env.local` según el README. Los archivos `test/*.integration.sql` contienen transacciones de prueba que revierten sus cambios.
