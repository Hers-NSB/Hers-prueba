# HERS · Entorno de pruebas

La aplicación de pruebas usa React, Vite, Supabase y Cloudflare Workers. El panel de administración incluye Finanzas, Dropper y Conectores. Consulta el estado del despliegue en [STATUS.md](STATUS.md). [Abrir HERS de pruebas](https://hers-prueba.datosenviados07.workers.dev/).

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

GitHub Actions ejecuta las pruebas SQL en una instancia local desechable de Supabase. Para ejecutarlas en **Hers prueba**, aplica primero las migraciones pendientes. Cada prueba revierte sus datos al terminar.

- `test/finance.integration.sql` y `test/integrations.integration.sql` prueban los permisos, las vigencias, las importaciones y el almacenamiento de credenciales.
- `test/finance_movements_model_shares.integration.sql` prueba los movimientos, las categorías y las bajas del directorio.
- `test/finance_pay_periods.integration.sql` prueba el cierre quincenal, los porcentajes de pago, el avance de la quincena, la importación de chatters inactivos y que confirmar dos veces un pago genere una sola inversión.
- `test/finance_current_period.integration.sql` comprueba los pagos por modelos asignados, los cambios de porcentaje en la quincena, los permisos y las descripciones de categorías.

La portada reutiliza el HTML, los estilos y las imágenes del ZIP vigente. Las migraciones configuran la tabla de Postulaciones y su almacenamiento privado de fotos. El acceso de modelos requiere su configuración propia en el proyecto de pruebas.

## Estructura y continuidad

- `src/` contiene la portada y el panel de administración. `src/panel/finanzas/` contiene Resumen, Movimiento, Empleados y Pagos. `src/panel/integrations/` contiene Conectores.
- `cloudflare/` contiene el Worker, la importación de estadísticas y el directorio de AgencyKey. `supabase/` contiene las migraciones y las funciones del proyecto.
- `test/` contiene las pruebas de JavaScript y las pruebas de integración SQL.

Después de cada conjunto de cambios, actualiza [STATUS.md](STATUS.md) con los archivos, decisiones, verificaciones y pendientes. Revisa también este README y actualízalo cuando cambie el uso, la instalación, la configuración o la estructura.

## Finanzas y pagos

- **Resumen** muestra Bóveda de HERS, Inversión, Ganancia y Ventas netas. Ganancia es Ventas netas menos Inversión. **Resultado operativo** muestra las ventas netas diarias antes del reparto como Ingreso, junto con la Inversión diaria. El gráfico de áreas muestra los importes en dólares enteros. Consulta la fecha y los importes con el puntero o las flechas del teclado. En **Por modelo** y **Por plataforma**, Ganancia muestra la diferencia entre Inversión y Ventas netas sin signo.
- **Movimiento** permite filtrar por **Fechas**, **Tipo**, **Categoría**, **Modelo**, **Plataforma** y **Actualizado**. Los movimientos sin modelo o plataforma se muestran como **Otros**. La descripción del movimiento admite varias líneas. En **Categoría** puedes seleccionar, crear, editar o eliminar y guardar una descripción propia. Pasa el cursor, enfoca o toca la categoría en la tabla para ver la descripción del movimiento. En el panel **Categorías**, el icono de información muestra la descripción de la categoría.
- **Empleados** separa **Modelos** y **Otros empleados**. Los chatters desactivados conservan el acceso a sus ventas, pagos e historial con la etiqueta **Inactivo** en la tabla y en el panel **Pagos**.
- En **Pagos**, pulsa el porcentaje de pago de la quincena para ajustarlo. Para los empleados manuales, **Editar** permite cambiar sus datos y los modelos asignados. **Eliminar** está en el mismo panel y conserva el historial del empleado. El porcentaje guardado se aplica a toda la quincena en curso, desde su primer día. Los cortes cerrados conservan el importe y el porcentaje registrados.
- **Pago ($)** aplica el porcentaje configurado al neto de la base correspondiente. Para los chatters vinculados, toma las ventas atribuidas por AgencyKey aunque el directorio marque al chatter como inactivo. Para los empleados con modelos asignados, toma las ventas netas diarias de esos modelos y suma las comisiones antes de redondear el pago total al dólar más cercano.
- **Pagos** muestra las ventas netas acumuladas, el pago estimado en dólares enteros y los días importados de la quincena en curso. Los pagos nuevos y sus movimientos se guardan en dólares enteros. Las quincenas van del 1 al 15 y del 16 al último día del mes en la zona de reporte de AgencyKey. HERS cierra el corte al terminar el período y confirmar la importación de todos sus días. El historial se puede filtrar por fecha y habilita **Pagar** en los cortes pendientes con importe positivo.
- La confirmación marca el corte como **Pagado** y registra un solo movimiento de **Inversión** en la fecha de confirmación. La categoría es **Equipo** para empleados y **Modelo** para modelos. Las ventas y el porcentaje histórico se guardan al cerrar cada corte nuevo.

## Cloudflare y AgencyKey

### Dropper

**Dropper** muestra los bots en línea, el resumen diario según la hora de Caracas y el cambio de contraseña de Windows. **Conectores → Bots** reúne la clave API para los bots, la sesión compartida de AgencyKey y la administración de Telegram. La app informa cada 30 segundos qué bots están en ejecución. El panel considera en línea el último aviso recibido en los 90 segundos anteriores.

El código de Windows y su Worker viven en [`dropper/`](dropper/). El Worker `hers-prueba-dropper` usa su propia D1. HERS lo consulta mediante el binding de servicio `DROPPER` y verifica la sesión administrativa de Supabase. Al cambiar de instalación, detén primero los bots anteriores para evitar que ambas instalaciones usen los mismos tokens al mismo tiempo.

Después de la migración, configura la clave de AgencyKey en **Conectores → Bots**, abre **Editar** para cada ficha y guarda su token y sus usuarios autorizados. Define la contraseña de escritorio desde **Dropper → Ajustes**. Abre la aplicación nueva y conecta la sesión compartida de AgencyKey desde **Conectores → Bots**.

Si una cuenta necesita ajustes de carga de AgencyKey, guarda su `agencykey-perfiles.json` privado al lado del ejecutable. El instalador público lleva una plantilla vacía.

Para publicar el instalador, GitHub Actions compila y prueba `HERS-Dropper.exe` al integrar cambios de Windows en `main` o al publicar un tag `hers-dropper-*`. El release conserva el ejecutable y las fuentes del codificador. Con R2 activado, sube ese ejecutable al objeto `windows/HERS-Dropper.exe` en un bucket privado, añade al Worker web el binding R2 `DROPPER_DOWNLOADS` y regístralo en `cloudflare/deploy.json`. Verifica que `/api/admin/dropper/download/windows` entregue el mismo ejecutable.
