# HERS · Entorno de pruebas

La aplicación de pruebas usa React, Vite, Supabase y Cloudflare Workers. El panel de administración incluye Finanzas y Conectores. [Abrir HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/).

## Desarrollo

Requiere Node.js 24. Copia `.env.example` a `.env.local` y configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con la URL y la clave publicable del mismo proyecto de Supabase.

```sh
npm ci
npm run dev
npm run build
npm test
```

El proyecto de pruebas nace vacío. Aplica las migraciones de `supabase/migrations` y despliega `team-login`. Para dar acceso a una cuenta existente y autorizada del Supabase de pruebas, configura su `app_metadata.role` como `admin` usando la API administrativa de Supabase. En la página, abre Equipo → Administrador e inicia sesión con el correo completo. El inicio de sesión de pruebas también acepta el nombre de una cuenta del dominio `@hers-prueba.example`. Una sesión tiene que renovarse si cambia su rol.

Los archivos `test/finance.integration.sql` y `test/integrations.integration.sql` comprueban permisos, vigencias, movimientos, importaciones y el almacenamiento de credenciales. Ejecútalos en el SQL Editor de **Hers prueba**. Cada prueba revierte sus datos al terminar.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Postulaciones, Historias, el acceso de modelos y EmailJS requieren su configuración propia en el proyecto de pruebas.

## Finanzas y reparto

- **Resumen** muestra ingresos, gastos, utilidad y ventas del CRM, con filtros de fecha, modelo y plataforma. **Movimientos** permite registrar operaciones manuales en USD.
- **Empleados** permite agregar chatters y modelos y asignar porcentajes a cada persona, a Dropper y a Agencia HERS. Selecciona **Vigente desde** y guarda la regla. Cada revisión queda en el historial.
- El reparto aplica a cada día la regla vigente sobre el neto importado de todos los modelos. Los porcentajes admiten dos decimales y pueden sumar hasta el 100 %. La parte sin asignar va a la bóveda de Agencia HERS.
- **Comisiones** muestra el cálculo sobre las ventas atribuidas y el historial de sus porcentajes. El resultado operativo descuenta comisiones y gastos. El resultado después de inversión también descuenta la inversión.

## Cloudflare y AgencyKey

Publica `dist/` como recursos estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo de entrada junto con `cloudflare/integrations.js`. Vincula los recursos como `ASSETS` y dirige primero al Worker las rutas `/api/admin/integrations` y `/api/admin/integrations/*`. La sincronización se realiza al pulsar **Actualizar** en Finanzas. El Worker se publica sin disparadores programados. La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

En **Administrador → Conectores**, pulsa **Configurar AgencyKey** o **Reemplazar** y guarda una clave API con acceso a los modelos, sus estadísticas de ingresos de OnlyFans y al reporte de empleados. **Probar conexión** consulta el último día cerrado sin guardar ventas. **Actualizar** en Finanzas sincroniza las fechas elegibles del período seleccionado.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas. Para los despliegues existentes, el Worker admite también la configuración previa de `AGENCYKEY_API_KEY` y `SUPABASE_SYNC_KEY` cuando el RPC de integración aún no está configurado.

El Worker consulta los modelos accesibles y el gráfico de ingresos de OnlyFans mediante el [proxy público de AgencyKey](https://app.agencykey.com/api/public-docs/). Guarda el neto de cada modelo por día mediante una actualización transaccional. El reporte de empleados alimenta el selector de **Agregar desde AgencyKey**. Finanzas muestra un aviso cuando un importe neto está pendiente.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
