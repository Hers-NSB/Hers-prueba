# HERS · Entorno de pruebas

La aplicación de pruebas usa React, Vite, Supabase y Cloudflare Workers. El panel de administración incluye Finanzas y Conectores. [Abrir HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/).

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

Los archivos `test/finance.integration.sql` y `test/integrations.integration.sql` comprueban permisos, vigencias, movimientos, importaciones y el almacenamiento de credenciales. Ejecútalos en el SQL Editor de **Hers prueba**. Cada prueba revierte sus datos al terminar.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Las migraciones configuran la tabla de Postulaciones y su almacenamiento privado de fotos. Historias y el acceso de modelos requieren su configuración propia en el proyecto de pruebas.

## Finanzas y reparto

- **Resumen** muestra el ingreso, la inversión, la ganancia y las ventas netas. El selector admite fechas rápidas y rangos personalizados.
- **Movimiento** permite filtrar el historial, registrar ingresos o inversiones en USD, administrar categorías y editar movimientos.
- **Empleados** admite personas manuales y empleados activos de AgencyKey. Usa **Editar** para guardar un porcentaje y una fecha de vigencia. Los chatters vinculados a AgencyKey cobran sobre sus ventas netas atribuidas en todas las cuentas. Para los otros empleados, selecciona las modelos que les corresponden. Cada modelo cobra sobre el neto de su propia cuenta. La bóveda recibe el saldo después de los repartos. Los días previos al primer reparto nuevo conservan el cálculo anterior.
- Ejecuta `test/finance_movements_model_shares.integration.sql` en Supabase de pruebas para comprobar el registro, la edición, los permisos y las bajas del directorio. La prueba revierte todos sus cambios.

## Cloudflare y AgencyKey

Publica `dist/` como recursos estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo de entrada junto con `cloudflare/integrations.js` y `cloudflare/agencykey-directory.js`. Activa la redacción de cadenas de consulta en Observabilidad del Worker para que los códigos OAuth queden fuera de sus registros. Vincula los recursos como `ASSETS` y dirige primero al Worker las rutas `/api/admin/integrations`, `/api/admin/integrations/*` y `/restablecer-contrasena` (con y sin la barra final). El Worker se publica sin disparadores programados. La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

En **Administrador → Conectores**, pulsa **Configurar AgencyKey** o **Reemplazar** y guarda una clave API con acceso a los modelos, sus estadísticas de ingresos de OnlyFans y al reporte de empleados. **Probar conexión** consulta el último día cerrado sin guardar ventas. Para importar datos, selecciona el período en **Finanzas → Resumen** y pulsa **Actualizar**. Luego abre **Empleados** para consultar la ganancia de cada chatter vinculado con un porcentaje vigente.

Para sincronizar el directorio, entra en **Finanzas → Empleados → Conectar directorio de AgencyKey** y autoriza HERS con una cuenta que tenga acceso al equipo completo y a las modelos de la agencia. Al abrir Empleados se actualizan los nombres y roles, y salen del listado las cuentas que ya no aparecen o están inactivas. Las ventas siguen usando la clave API de Conectores.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas.

El Worker consulta los modelos accesibles y el gráfico de ingresos de OnlyFans mediante el [proxy público de AgencyKey](https://app.agencykey.com/api/public-docs/). Si el gráfico no devuelve el neto, usa el campo neto de las transacciones en USD del período y excluye las revertidas por contracargo. En la misma importación diaria, consulta el reporte de ventas atribuidas por empleado para todas las cuentas accesibles y guarda el importe neto tras descontar la comisión de OnlyFans. El directorio OAuth alimenta el selector **Agregar desde AgencyKey**. Los chatters que ya están vinculados pueden calcular su ganancia con la clave API de **Conectores**. Si falta el reporte del período, el importe aparece como pendiente de sincronizar. Los avisos de integración muestran un código de diagnóstico y una referencia por intento.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
