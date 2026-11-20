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

`test/finance.integration.sql` comprueba los permisos de visitante, chatter y administrador, las vigencias, la edición de movimientos y la importación repetida. Ejecútalo en el SQL Editor de **Hers prueba**. Se revierte al terminar.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Postulaciones, Historias, el acceso de modelos y EmailJS requieren su configuración propia en el proyecto de pruebas.

## Cloudflare y AgencyKey

Publica `dist/` como assets estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo. El trigger usa `0 11 * * *` (11:00 UTC). La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

Configura los secretos del Worker en Cloudflare → Workers & Pages → hers-prueba → Settings → Variables and Secrets.

- `AGENCYKEY_API_KEY` pertenece a una cuenta de AgencyKey con acceso de lectura a los modelos e integrantes requeridos y permisos `analytics.creators.viewList` y `analytics.employees.viewList`. El Worker usa el encabezado `x-public-api-key`.
- `SUPABASE_SYNC_KEY` es una clave secreta de servidor de **Hers prueba**, limitada al entorno de pruebas. El RPC de importación rechaza las claves publicables y las sesiones de usuarios.

El Worker lee `GET /api/v1/public/crm/reports/creators` y `GET /api/v1/public/crm/reports/employees` con `includeCreatorBreakdown=true` para este último. El [OpenAPI de AgencyKey](https://app.agencykey.com/api/public-docs/) documenta `totalSalesSum` en ambos. El reporte de creadores entrega un monto único. Las rutas públicas proxy de OnlyFans para transacciones y ganancias tienen un esquema abierto. Falta confirmar con una llamada autorizada cuáles campos proporcionan ambos importes por día y modelo. Finanzas muestra el total del CRM como tal y señala cuándo faltan los importes brutos y netos.

La importación reemplaza el día de forma atómica, con claves únicas de fecha/modelo/integrante. Actualiza la última importación correcta después de guardar ambos reportes. Con secretos ausentes omite el intento. Los movimientos e ingresos de la agencia se registran manualmente en USD. El cálculo de utilidad operativa descuenta comisiones y gastos, y el resultado después de inversión también descuenta la inversión.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
