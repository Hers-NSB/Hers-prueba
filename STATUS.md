# Estado de Hers-prueba

Verificado el 24 de noviembre de 2026. El [PR #22](https://github.com/Hers-NSB/Hers-prueba/pull/22) publicó la actualización de los paneles, Finanzas y Dropper desde el commit `b449922`.

## Integración en revisión

El [PR #24](https://github.com/Hers-NSB/Hers-prueba/pull/24) integra Dropper en `hers-prueba`. La administración usa la sesión verificada de HERS y la contraseña de conexión de Windows se administra en **Conectores → Bots**. La nueva D1 `hers-prueba` usa credenciales recién creadas. Los cuatro perfiles conservan su identidad y requieren registrar los tokens de Telegram. Se verificaron 2.738 publicaciones únicas en la nueva D1. Las migraciones de Finanzas y el bucket privado de fotos ya están aplicados en Supabase. La publicación del Worker queda pendiente de la clave de fotos y la verificación del ejecutable con el nuevo destino.

## Despliegue verificado

| Componente | Estado |
| --- | --- |
| [Web Hers-prueba](https://hers-prueba.datosenviados07.workers.dev/) | Versión 39 de `hers-prueba` al 100 % mediante Cloudflare Builds desde `main`. Usa [wrangler.jsonc](wrangler.jsonc). |
| Worker de Dropper | Versión 6 de `hers-prueba-dropper` al 100 %. D1 tiene la tabla `bot_leases` para impedir inicios simultáneos del mismo bot en las apps actualizadas. |
| Supabase de pruebas | Aplicada la migración [20261124220707_finance_import_reservations](supabase/migrations/20261124220707_finance_import_reservations.sql). La actualización manual y el cron reservan cada fecha antes de importar. |
| [HERS-Dropper.exe](https://github.com/Hers-NSB/Hers-prueba/releases/tag/hers-dropper-b449922f2ff1) | Ejecutable publicado, probado en Windows y verificado contra el archivo descargado de GitHub Releases. |

El cron de importación sigue activo a los minutos 5, 20, 35 y 50 en UTC. Finanzas cierra en la zona `America/Halifax`. Dropper usa la hora de Caracas. Ambos Workers de prueba comparten la clave de AgencyKey a través de `HERS_AGENCY_KEY` y su punto de entrada privado en la web.

## Cambios publicados

- **Paneles y Dropper.** El refresco se indica junto al título. Inicio muestra el total de bots activos y Dropper muestra sus nombres. El resumen incluye las modelos sin publicaciones y actualiza en segundo plano solo el día actual. La app de Windows muestra el total diario y reserva el bot antes de iniciarlo.
- **Finanzas.** Cambiar de período consulta Supabase. Las importaciones manuales y programadas respetan los días finalizados. El reparto de producción se calcula en SQL.
- **Postulaciones.** El panel pagina el listado y firma en bloque las URL de fotos al abrir o descargar una postulación. Si falta una foto esperada, detiene la descarga y muestra el aviso.
- **Conectores.** Servicios reúne la clave y la sesión compartida de AgencyKey. Bots administra los tokens de Telegram y las modelos asociadas.

Pasaron las verificaciones de GitHub Actions, incluidas las integraciones SQL y la compilación, prueba y publicación de Windows. Se verificó la portada publicada y el enlace privado entre Workers con una prueba de integración local. El repositorio usa las configuraciones de Wrangler y ya retiró el manifiesto duplicado `cloudflare/deploy.json`.

## Pendientes

- Al verificar Supabase, la quincena del 16 al 30 de noviembre tenía 8 de 15 días finalizados, 0 cortes y 0 pagos confirmados. Tras el primer pago, comprueba que genere una sola inversión con el importe y la categoría correctos.
- Sigue pendiente la revisión de `finance_model_shares_creator_id_idx`, `finance_movements_creator` y `finance_agencykey_attributions_creator` después de un ciclo completo de pagos.
- El Worker antiguo `dropper` todavía recibe llamadas de escritorio. Las instalaciones de este repositorio apuntan a `hers-prueba-dropper`. Usa la versión de Windows publicada arriba para que cada instancia reserve su bot antes de iniciarlo.

La configuración y los pasos de publicación están en el [README.md](README.md). Para consultar el historial anterior, usa el historial de Git de este archivo.
