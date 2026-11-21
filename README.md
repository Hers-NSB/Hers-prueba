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

- **Resumen** muestra las ventas netas, el ingreso de Agencia HERS, los gastos y la utilidad para el período seleccionado en el calendario.
- **Extracción** permite registrar ingresos, gastos e inversiones en USD, crear categorías y editar movimientos.
- **Empleados** permite agregar personas desde AgencyKey o manualmente, editar su nombre y rol, y retirarlas del listado conservando su historial.
- En **Empleados**, selecciona **Vigente desde** y guarda los porcentajes de reparto de empleados, modelos, Dropper y Agencia HERS. Cada revisión queda en el historial. El reparto usa las ventas netas del día y asigna a la bóveda de Agencia HERS la parte que queda sin repartir.

## Cloudflare y AgencyKey

Publica `dist/` como recursos estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo de entrada junto con `cloudflare/integrations.js`. Vincula los recursos como `ASSETS` y dirige primero al Worker las rutas `/api/admin/integrations` y `/api/admin/integrations/*`. La sincronización se realiza al pulsar **Actualizar** en Finanzas. El Worker se publica sin disparadores programados. La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

En **Administrador → Conectores**, pulsa **Configurar AgencyKey** o **Reemplazar** y guarda una clave API con acceso a los modelos, sus estadísticas de ingresos de OnlyFans y al reporte de empleados. **Probar conexión** consulta el último día cerrado sin guardar ventas. **Actualizar** en Finanzas sincroniza las fechas elegibles del período seleccionado.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas. Para los despliegues existentes, el Worker admite también la configuración previa de `AGENCYKEY_API_KEY` y `SUPABASE_SYNC_KEY` cuando el RPC de integración aún no está configurado.

El Worker consulta los modelos accesibles y el gráfico de ingresos de OnlyFans mediante el [proxy público de AgencyKey](https://app.agencykey.com/api/public-docs/). Si el gráfico no devuelve el neto, usa el campo neto de las transacciones en USD del período y excluye las revertidas por contracargo. Guarda el neto de cada modelo por día mediante una actualización transaccional. El reporte de empleados alimenta el selector de **Agregar desde AgencyKey**. Los avisos de integración muestran un código de diagnóstico y una referencia por intento.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
