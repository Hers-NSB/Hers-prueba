# HERS · Entorno de pruebas

La aplicación de pruebas usa React, Vite, Supabase y Cloudflare Workers. El entorno tiene su propio proyecto de Supabase y sus propios Workers. El panel de administración incluye Inicio, Finanzas, Dropper, Postulaciones y Conectores. Consulta el estado del despliegue en [STATUS.md](STATUS.md). [Abrir HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/).

## Desarrollo

Requiere Node.js 24. Copia `.env.example` a `.env.local` y configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con la URL y la clave publicable del mismo proyecto de Supabase.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm test
```

Si preparas una instancia local nueva, aplica las migraciones de `supabase/migrations` y sirve la función `team-login`. Para dar acceso a una cuenta existente y autorizada del Supabase de pruebas, configura su `app_metadata.role` como `admin` usando la API administrativa de Supabase. En la página, abre Equipo → Administrador e inicia sesión con el alias de administrador configurado en `admin_login_aliases` y la contraseña de la cuenta. El correo no se admite en el formulario de administrador. La tabla de alias es accesible únicamente desde el servidor. Una sesión tiene que renovarse si cambia su rol.

GitHub Actions ejecuta las pruebas SQL en una instancia local desechable de Supabase. Para ejecutarlas en **Hers prueba**, aplica primero las migraciones pendientes. Cada prueba revierte sus datos al terminar.

- `test/finance.integration.sql` y `test/integrations.integration.sql` prueban los permisos, las vigencias, las importaciones y el almacenamiento de credenciales.
- `test/finance_movements_model_shares.integration.sql` prueba los movimientos, las categorías y las bajas del directorio.
- `test/finance_pay_periods.integration.sql` prueba el cierre quincenal, los porcentajes de pago, el avance de la quincena, la importación de chatters inactivos y que confirmar dos veces un pago genere una sola inversión.
- `test/finance_current_period.integration.sql` comprueba los pagos por modelos asignados, los cambios de porcentaje en la quincena, los permisos y las descripciones de categorías.
- `test/finance_import_reservations.integration.sql` verifica que la reserva de un día se pueda reintentar y que una importación posterior conserve el neto finalizado.

La portada usa los recursos de `src/` y `public/`. El acceso de modelos requiere su configuración propia en el proyecto de pruebas.

## Estructura y continuidad

- `src/` contiene la portada y el panel de administración. `src/panel/finanzas/` contiene Resumen, Movimiento, Empleados y Pagos. `src/panel/integrations/` contiene Conectores.
- `cloudflare/` contiene el Worker, la importación de estadísticas y el directorio de AgencyKey. `supabase/` contiene las migraciones y las funciones del proyecto.
- `test/` contiene las pruebas de JavaScript y las pruebas de integración SQL.

Después de cada conjunto de cambios, actualiza [STATUS.md](STATUS.md) con los archivos, decisiones, verificaciones y pendientes. Revisa también este README y actualízalo cuando cambie el uso, la instalación, la configuración o la estructura.

## Finanzas y pagos

Cambiar de período consulta los datos guardados en Supabase. **Actualizar** y el cron comparten una reserva por fecha antes de consultar AgencyKey. Los días finalizados conservan sus ventas registradas. Para rectificaciones contables, registra un movimiento explícito con una descripción y la referencia al corte.

- **Resumen** muestra Bóveda de HERS, Inversión, Ganancia y Ventas netas. Ganancia es Ventas netas menos Inversión. **Resultado operativo** muestra las ventas netas diarias antes del reparto como Ingreso, junto con la Inversión diaria. El gráfico de áreas muestra los importes en dólares enteros. Consulta la fecha y los importes con el puntero o las flechas del teclado. En **Por modelo** y **Por plataforma**, Ganancia muestra la diferencia entre Inversión y Ventas netas sin signo.
- **Movimiento** permite filtrar por **Fechas**, **Tipo**, **Categoría**, **Modelo**, **Plataforma** y **Actualizado**. Los movimientos sin modelo o plataforma se muestran como **Otros**. La descripción del movimiento admite varias líneas. En **Categoría** puedes seleccionar, crear, editar o eliminar y guardar una descripción propia. Pasa el cursor, enfoca o toca la categoría en la tabla para ver la descripción del movimiento. En el panel **Categorías**, el icono de información muestra la descripción de la categoría.
- **Empleados** separa **Modelos** y **Otros empleados**. Los chatters desactivados conservan el acceso a sus ventas, pagos e historial con la etiqueta **Inactivo** en la tabla y en el panel **Pagos**.
- En **Pagos**, pulsa el porcentaje de pago de la quincena para ajustarlo. Para los empleados manuales, **Editar** permite cambiar sus datos y los modelos asignados. **Eliminar** está en el mismo panel y conserva el historial del empleado. El porcentaje guardado se aplica a toda la quincena en curso, desde su primer día. Los cortes cerrados conservan el importe y el porcentaje registrados.
- **Pago ($)** aplica el porcentaje configurado al neto de la base correspondiente. Para los chatters vinculados, toma las ventas atribuidas por AgencyKey aunque el directorio marque al chatter como inactivo. Para los empleados con modelos asignados, toma las ventas netas diarias de esos modelos y suma las comisiones antes de redondear el pago total al dólar más cercano.
- **Pagos** muestra las ventas netas acumuladas, el pago estimado en dólares enteros y los días importados de la quincena en curso. Los pagos nuevos y sus movimientos se guardan en dólares enteros. Las quincenas van del 1 al 15 y del 16 al último día del mes en la zona de reporte de AgencyKey. HERS cierra el corte al terminar el período y confirmar la importación de todos sus días. El historial se puede filtrar por fecha y habilita **Pagar** en los cortes pendientes con importe positivo.
- La confirmación marca el corte como **Pagado** y registra un solo movimiento de **Inversión** en la fecha de confirmación. La categoría es **Equipo** para empleados y **Modelo** para modelos. Las ventas y el porcentaje histórico se guardan al cerrar cada corte nuevo.

## Postulaciones

El formulario guarda las fotos en un bucket privado. El panel carga las postulaciones por páginas y solicita las URL firmadas de una postulación juntas al abrir su detalle o iniciar su descarga. Si falta alguna foto esperada, muestra un aviso y detiene el ZIP.

## Dropper y AgencyKey

**Inicio** muestra cuántos bots están en línea. **Dropper** muestra sus nombres y el resumen diario de todas las modelos configuradas, incluidas las que tienen cero publicaciones. Cada fila indica la hora de la última publicación, cuando existe, y el total `publicadas / 400` según la hora de Caracas. El día actual se actualiza automáticamente y el histórico se consulta al seleccionar una fecha o al pulsar **Actualizar**. La app muestra `publicadas / 400` por modelo y reserva el bot en el servidor antes de conectarse a Telegram. Actualiza todos los ejecutables para que cada instancia reserve el bot desde el inicio.

**Conectores → Servicios** administra la clave API común de AgencyKey y la sesión compartida que usa Windows para verificar perfiles y grabar. La autorización OAuth del directorio se mantiene para consultar empleados. **Conectores → Bots** administra los tokens de Telegram y las modelos asociadas.

Dropper usa la sesión de administrador de HERS. La contraseña de conexión de Windows se configura en **Conectores → Bots → Acceso de las apps**. El ejecutable se descarga desde [GitHub Releases de Hers-prueba](https://github.com/Hers-NSB/Hers-prueba/releases).

Si una cuenta necesita ajustes de carga de AgencyKey, guarda su `agencykey-perfiles.json` privado al lado del ejecutable. El instalador público lleva una plantilla vacía.

## Despliegue

| Componente | Configuración y publicación |
| --- | --- |
| Web `hers-prueba` | [wrangler.jsonc](wrangler.jsonc). Cloudflare Builds compila y despliega desde `main`. El cron de importación se ejecuta a los minutos 5, 20, 35 y 50 en UTC. |
| Dropper integrado | El Worker `hers-prueba` ejecuta las rutas de Dropper y el cron de drops manuales. La conexión `DROPPER_DB` y sus [migraciones D1](dropper/cloudflare/migrations/) se configuran en [wrangler.jsonc](wrangler.jsonc). |
| Supabase | [Migraciones](supabase/migrations/) y [función team-login](supabase/functions/team-login/). |
| Windows | [GitHub Actions](.github/workflows/dropper-windows.yml) compila, prueba y publica `HERS-Dropper.exe` al integrar cambios de Windows en `main` o al publicar un tag `hers-dropper-*`. El release incluye las fuentes del codificador. |

Dropper verifica la sesión administrativa de Supabase y lee la clave de AgencyKey que HERS guarda en Conectores. En `hers-prueba`, configura `DROPPER_ACCESS_TOKEN` para Windows y `DROPPER_ENCRYPTION_KEY` para las configuraciones cifradas. Los drops con fotos se leen del bucket privado `manual-drop-photos` mediante la función de Supabase `manual-drop-photo`. HERS presenta `DROPPER_PHOTO_TOKEN` y Supabase valida su huella antes de leer el archivo. El punto de entrada `DropperAgencyKey` sigue disponible durante la transición del Worker anterior. Consulta [STATUS.md](STATUS.md) para conocer el estado del despliegue.
