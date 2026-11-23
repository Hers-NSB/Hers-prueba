# HERS · Entorno de pruebas

La aplicación de pruebas usa React, Vite, Supabase y Cloudflare Workers. El panel de administración incluye Finanzas y Conectores. Consulta el estado del despliegue en [STATUS.md](STATUS.md). [Abrir HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/).

## Desarrollo

Requiere Node.js 24. Copia `.env.example` a `.env.local` y configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con la URL y la clave publicable del mismo proyecto de Supabase.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm test
```

El proyecto de pruebas nace vacío. Aplica las migraciones de `supabase/migrations` y despliega `team-login`. Para dar acceso a una cuenta existente y autorizada del Supabase de pruebas, configura su `app_metadata.role` como `admin` usando la API administrativa de Supabase. En la página, abre Equipo → Administrador e inicia sesión con el correo completo. El inicio de sesión de pruebas también acepta el nombre de una cuenta del dominio `@hers-prueba.example`. Una sesión tiene que renovarse si cambia su rol.

Ejecuta las pruebas SQL en el SQL Editor de **Hers prueba**. Cada prueba revierte sus datos al terminar.

- `test/finance.integration.sql` y `test/integrations.integration.sql` prueban los permisos, las vigencias, las importaciones y el almacenamiento de credenciales.
- `test/finance_movements_model_shares.integration.sql` prueba los movimientos, las categorías y las bajas del directorio.
- `test/finance_pay_periods.integration.sql` prueba el cierre quincenal, los porcentajes de pago, el avance de la quincena, la importación de chatters inactivos y que confirmar dos veces un pago genere una sola inversión.
- `test/finance_current_period.integration.sql` comprueba los pagos por modelos asignados, los cambios de porcentaje en la quincena, los permisos y las descripciones de categorías.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Las migraciones configuran la tabla de Postulaciones y su almacenamiento privado de fotos. Historias y el acceso de modelos requieren su configuración propia en el proyecto de pruebas.

## Estructura y continuidad

- `src/` contiene la portada y el panel de administración. `src/panel/finanzas/` contiene Resumen, Movimiento, Empleados y Pagos. `src/panel/integrations/` contiene Conectores.
- `cloudflare/` contiene el Worker, la importación de estadísticas y el directorio de AgencyKey. `supabase/` contiene las migraciones y las funciones del proyecto.
- `test/` contiene las pruebas de JavaScript y las pruebas de integración SQL.

Después de cada conjunto de cambios, actualiza [STATUS.md](STATUS.md) con los archivos, decisiones, verificaciones y pendientes. Revisa también este README y actualízalo cuando cambie el uso, la instalación, la configuración o la estructura.

## Finanzas y pagos

- **Resumen** muestra Bóveda de HERS, Inversión, Ganancia y Ventas netas. Ganancia es Ventas netas menos Inversión. **Resultado operativo** muestra Ingreso e Inversión en un gráfico de áreas adaptable con importes en dólares enteros. Consulta la fecha y los importes con el puntero o las flechas del teclado. En **Por modelo** y **Por plataforma**, Ganancia muestra la diferencia entre Inversión y Ventas netas sin signo.
- **Movimiento** permite filtrar por **Fechas**, **Tipo**, **Categoría**, **Modelo**, **Plataforma** y **Actualizado**. Los movimientos sin modelo o plataforma se muestran como **Otros**. La descripción del movimiento admite varias líneas. En **Categoría** puedes seleccionar, crear, editar o eliminar y guardar una descripción propia. Pasa el cursor, enfoca o toca la categoría en la tabla para ver la descripción del movimiento. En el panel **Categorías**, el icono de información muestra la descripción de la categoría.
- **Empleados** separa **Modelos** y **Otros empleados**. Los chatters desactivados conservan el acceso a sus ventas, pagos e historial con la etiqueta **Inactivo** en la tabla y en el panel **Pagos**.
- En **Pagos**, pulsa el porcentaje de pago de la quincena para ajustarlo. Para los empleados manuales, **Editar** permite cambiar sus datos y los modelos asignados. **Eliminar** está en el mismo panel y conserva el historial del empleado. El porcentaje guardado se aplica a toda la quincena en curso, desde su primer día. Los cortes cerrados conservan el importe y el porcentaje registrados.
- **Pago ($)** aplica el porcentaje configurado al neto de la base correspondiente. Para los chatters vinculados, toma las ventas atribuidas por AgencyKey aunque el directorio marque al chatter como inactivo. Para los empleados con modelos asignados, toma las ventas netas diarias de esos modelos y suma las comisiones antes de redondear el pago total al dólar más cercano.
- **Pagos** muestra las ventas netas acumuladas, el pago estimado en dólares enteros y los días importados de la quincena en curso. Los pagos nuevos y sus movimientos se guardan en dólares enteros. Las quincenas van del 1 al 15 y del 16 al último día del mes en la zona de reporte de AgencyKey. HERS cierra el corte al terminar el período y confirmar la importación de todos sus días. El historial se puede filtrar por fecha y habilita **Pagar** en los cortes pendientes con importe positivo.
- La confirmación marca el corte como **Pagado** y registra un solo movimiento de **Inversión** en la fecha de confirmación. La categoría es **Equipo** para empleados y **Modelo** para modelos. Las ventas y el porcentaje histórico se guardan al cerrar cada corte nuevo.

## Cloudflare y AgencyKey

### Despliegue del entorno

Publica `dist/` como recursos estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo de entrada junto con `cloudflare/integrations.js` y `cloudflare/agencykey-directory.js`. Activa la redacción de cadenas de consulta en Observabilidad del Worker para que los códigos OAuth queden fuera de sus registros. Vincula los recursos como `ASSETS` y dirige primero al Worker las rutas `/api/admin/integrations`, `/api/admin/integrations/*` y `/restablecer-contrasena` (con y sin la barra final). Aplica las migraciones pendientes a Supabase de pruebas antes de publicar el Worker. El disparador del entorno es `5,20,35,50 * * * *` (UTC). El Worker empieza por el día completo pendiente más antiguo. Si una consulta de transacciones devuelve 502, 503 o 504, reintenta esa consulta dos veces con pausas de uno y tres segundos. Si se agotan los intentos, deja el día pendiente y prueba el siguiente día disponible de la misma quincena en ese ciclo. El cierre requiere todos los días completos. La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

Después de publicar, confirma que el Worker sirve el HTML y los recursos del build, que `/api/admin/integrations` devuelve 401 sin sesión y que la ruta retirada `/restablecer-contrasena` devuelve 410. Registra la versión activa y la última migración aplicada en [STATUS.md](STATUS.md).

### Sincronización de AgencyKey

En **Administrador → Conectores**, pulsa **Configurar AgencyKey** o **Reemplazar** y guarda una clave API con acceso a los modelos, sus estadísticas de ingresos de OnlyFans y al reporte de empleados. **Probar conexión** consulta el último día cerrado sin guardar ventas. Al cambiar el rango en **Finanzas → Resumen**, se importan los días con datos incompletos. Pulsa **Actualizar** para sincronizar los días incompletos y volver a consultar el día en curso si está dentro del período. Desde **Empleados**, la acción usa la quincena actual. Al mantener abierta esa pestaña, solo se consulta automáticamente el avance y los importes de la quincena.

La activación del directorio es opcional. Cuando quieras conectarlo, abre **Conectores → Autorizar directorio de AgencyKey** y usa una cuenta con acceso a todo el equipo y a los modelos de la agencia. Una vez autorizado, los modelos y los chatters se sincronizan al abrir **Empleados** por primera vez en cada visita a Finanzas y al pulsar **Actualizar**. El directorio incluye los que estén desactivados en AgencyKey. Los modelos inactivos aparecen con su estado en la tabla **Modelos**. La importación de ventas usa la clave API de Conectores.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas.

El Worker consulta los modelos accesibles y el gráfico de ingresos de OnlyFans mediante el [proxy público de AgencyKey](https://app.agencykey.com/api/public-docs/). Si el gráfico no devuelve el neto, usa el campo neto de las transacciones en USD del período y excluye las revertidas por contracargo. En la misma importación diaria, consulta el reporte de ventas atribuidas por empleado para todas las cuentas accesibles y guarda el importe neto tras descontar la comisión de OnlyFans. Si AgencyKey devuelve 429 con un `Retry-After` de hasta diez segundos, el Worker espera antes de reintentar. Para una espera mayor, devuelve el 429 con la cabecera y Finanzas detiene el lote. Los avisos de integración muestran un código de diagnóstico y una referencia por intento.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
