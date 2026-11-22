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
- `test/finance_pay_periods.integration.sql` prueba el cierre quincenal, los permisos y que confirmar dos veces un pago genere una sola inversión.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Las migraciones configuran la tabla de Postulaciones y su almacenamiento privado de fotos. Historias y el acceso de modelos requieren su configuración propia en el proyecto de pruebas.

## Finanzas y pagos

- **Resumen** muestra Bóveda de HERS, Inversión, Ganancia y Ventas netas. Ganancia es Ventas netas menos Inversión. **Resultado operativo** muestra Ingreso e Inversión en barras apiladas y destaca el ingreso máximo y mínimo del período. En **Por modelo** y **Por plataforma**, Ganancia muestra la diferencia entre Inversión y Ventas netas sin signo.
- **Movimiento** permite elegir un rango con **Fechas** y restablecer todos los filtros con **Limpiar filtros**. Al registrar un movimiento, abre **Categoría** para seleccionar, crear, editar o eliminar una categoría. La descripción es el último campo del formulario.
- **Empleados** muestra el total de modelos y chatters, con el nombre y el rol de cada persona. En **Editar** puedes configurar el porcentaje y su fecha de vigencia. **Pagos** abre el historial individual, con filtros de fechas y estado.
- **Pago (USD)** muestra el neto individual menos el porcentaje vigente. Las quincenas van del 1 al 15 y del 16 al último día del mes, en la zona del reporte de AgencyKey. El importe vuelve a empezar con la nueva quincena. Cuando termina un período y se han importado todos sus días, los importes positivos quedan **Pendientes de pago**.
- En **Pagos**, la confirmación marca el corte como **Pagado** y registra un solo movimiento de **Inversión** en la fecha de confirmación. La categoría es **Equipo** para empleados y **Modelo** para modelos. Las ventas y el porcentaje histórico se guardan al cerrar cada corte nuevo.

## Cloudflare y AgencyKey

### Despliegue del entorno

Publica `dist/` como recursos estáticos del Worker `hers-prueba` y `cloudflare/worker.js` como módulo de entrada junto con `cloudflare/integrations.js` y `cloudflare/agencykey-directory.js`. Activa la redacción de cadenas de consulta en Observabilidad del Worker para que los códigos OAuth queden fuera de sus registros. Vincula los recursos como `ASSETS` y dirige primero al Worker las rutas `/api/admin/integrations`, `/api/admin/integrations/*` y `/restablecer-contrasena` (con y sin la barra final). Aplica las migraciones pendientes a Supabase de pruebas antes de publicar el Worker. El disparador del entorno es `5,20,35,50 * * * *` (UTC). El Worker importa un día completo pendiente por ejecución y vuelve a intentarlo en la siguiente si falla. La zona del día de reporte es `America/Halifax`, según AgencyKey, y se puede ajustar con `AGENCYKEY_REPORT_TIMEZONE`.

### Sincronización de AgencyKey

En **Administrador → Conectores**, pulsa **Configurar AgencyKey** o **Reemplazar** y guarda una clave API con acceso a los modelos, sus estadísticas de ingresos de OnlyFans y al reporte de empleados. **Probar conexión** consulta el último día cerrado sin guardar ventas. Para importar datos, selecciona el período en **Finanzas → Resumen** y pulsa **Actualizar**. Para sincronizar la quincena actual, pulsa **Actualizar** desde **Empleados**.

La activación del directorio es opcional. Cuando quieras conectarlo, abre **Conectores → Autorizar directorio de AgencyKey** y usa una cuenta con acceso a todo el equipo y a los modelos de la agencia. Una vez autorizado, al abrir **Empleados** se sincronizan los modelos y chatters activos. Las cuentas inactivas conservan su historial en **Personas inactivas**. La importación de ventas usa la clave API de Conectores.

El panel permite guardar o reemplazar claves API, tokens y contraseñas de otros servicios. El Worker usa actualmente la credencial de AgencyKey. La lista de credenciales devuelve el nombre, el tipo y la fecha de actualización. La contraseña de acceso a HERS pertenece a Supabase Auth.

La configuración inicial del Worker requiere `HERS_INTEGRATIONS_SECRET` (32 bytes aleatorios en Base64) como secreto, `SUPABASE_PUBLISHABLE_KEY` (clave publicable de «Hers prueba») como variable y el hash SHA-256 del token derivado por `bridgeToken` en `hers_private.integration_backend.token_hash`. Configura estos valores una vez por entorno mediante Cloudflare y Supabase. El secreto cifra las credenciales y permite al Worker llamar al RPC acotado de integración. Su reemplazo requiere recifrar las credenciales guardadas.

El Worker consulta los modelos accesibles y el gráfico de ingresos de OnlyFans mediante el [proxy público de AgencyKey](https://app.agencykey.com/api/public-docs/). Si el gráfico no devuelve el neto, usa el campo neto de las transacciones en USD del período y excluye las revertidas por contracargo. En la misma importación diaria, consulta el reporte de ventas atribuidas por empleado para todas las cuentas accesibles y guarda el importe neto tras descontar la comisión de OnlyFans. Los avisos de integración muestran un código de diagnóstico y una referencia por intento.

Referencias de la vista web.

- [QuickBooks · Informes financieros](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-to-run-and-read-financial-reports-in-quickbooks-online-376028)
- [Xero · Filtros de informes](https://central.xero.com/0/guide/a5B3m000000rnPSEAY/get-ready-to-use-xero)
- [Float · Importación diaria](https://intercom.help/floatapp/en/articles/1888809-daily-sync)
