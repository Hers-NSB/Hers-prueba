# HERS · Entorno de pruebas

La versión web usa Vite, Supabase «Hers prueba» y Cloudflare Workers. El panel de administrador contiene Finanzas.

## Desarrollo

Requiere Node.js 24. Copia `.env.example` a `.env.local` y configura `VITE_SUPABASE_ANON_KEY` con la **clave publicable** de Supabase «Hers prueba».

```sh
npm ci
npm run dev
npm run build
npm test
```

El proyecto de pruebas nace vacío. Aplica las migraciones de `supabase/migrations` y despliega `team-login`. Para dar acceso a una cuenta existente y autorizada del Supabase de pruebas, configura su `app_metadata.role` como `admin` usando la API administrativa de Supabase. En la página, abre Acceder → Administrador e inicia sesión con el correo completo. El inicio de sesión de pruebas también acepta el nombre de una cuenta del dominio `@hers-prueba.example`. Una sesión tiene que renovarse si cambia su rol.

Para configurar una contraseña por correo, abre **Acceder al panel del equipo → Administrador → Crear o restablecer contraseña**. En Supabase Auth → URL Configuration, añade como Redirect URL `https://hers-prueba.datosenviados07.workers.dev/restablecer-contrasena`. El enlace abre una sesión de recuperación aislada para guardar la nueva contraseña y volver al acceso.

`test/finance.integration.sql` comprueba los permisos de visitante, chatter y administrador, las vigencias, la edición de movimientos y la importación repetida. Ejecútalo en el SQL Editor de **Hers prueba**. Se revierte al terminar.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Postulaciones, Historias, el acceso de modelos y EmailJS requieren su configuración propia en el proyecto de pruebas.

## Cloudflare y AgencyKey

Publica `dist/` como assets estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo. El trigger usa `0 11 * * *` (11:00 UTC). La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

En **Administrador → Integraciones**, selecciona `agencykey` y guarda la clave API de una cuenta con acceso de lectura y permisos `analytics.creators.viewList` y `analytics.employees.viewList`. Usa **Probar conexión** para consultar ambos reportes del último día cerrado sin guardar ventas. **Sincronizar ahora** importa ese mismo día. El disparador diario usa la misma credencial.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas. Para los despliegues existentes, el Worker admite también la configuración previa de `AGENCYKEY_API_KEY` y `SUPABASE_SYNC_KEY` cuando el RPC de integración aún no está configurado.

El Worker lee `GET /api/v1/public/crm/reports/creators` y `GET /api/v1/public/crm/reports/employees` con `includeCreatorBreakdown=true` para este último. El [OpenAPI de AgencyKey](https://app.agencykey.com/api/public-docs/) documenta `totalSalesSum` en ambos. El reporte de creadores entrega un monto único. Las rutas públicas proxy de OnlyFans para transacciones y ganancias tienen un esquema abierto. Falta confirmar con una llamada autorizada cuáles campos proporcionan ambos importes por día y modelo. Finanzas muestra el total del CRM como tal y señala cuándo faltan los importes brutos y netos.

La importación reemplaza el día de forma atómica, con claves únicas de fecha/modelo/integrante. Actualiza la última importación correcta después de guardar ambos reportes. Con secretos ausentes omite el intento. Los movimientos e ingresos de la agencia se registran manualmente en USD. El cálculo de utilidad operativa descuenta comisiones y gastos, y el resultado después de inversión también descuenta la inversión.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
