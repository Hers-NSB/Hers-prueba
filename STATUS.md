# Estado de Hers-prueba

Entorno web de pruebas de HERS. Fecha de verificación: 2026-11-21.

- [PR #5](https://github.com/Hers-NSB/Hers-prueba/pull/5) integrado en `main`. Finanzas incluye calendario de rango, categorías, gestión de empleados, reparto y bóveda. El menú principal muestra Conectores.
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/) sirve la versión 15 del Worker. Se retiró el disparador diario tras verificar **Finanzas → Actualizar** en el sitio activo.
- Supabase de pruebas tiene registrada la migración `20261120223500_finance_manual_updates`. La actualización manual del 19 de noviembre guardó el neto de cinco modelos por un total de USD 36,00. El panel mostró ese importe en Ventas netas y en la bóveda de Agencia HERS.
- Pasaron ESLint, las 16 pruebas y la compilación.

## Postulaciones

- La rama `postulaciones-sin-emailjs` elimina EmailJS y los comentarios del código. El formulario conserva la confirmación en pantalla tras guardar.
- Supabase de pruebas tiene aplicada la migración `20261121154801_applications`. Se verificó el envío anónimo y el acceso administrativo a las postulaciones y sus fotos. La prueba SQL se revirtió.
- El formulario se comprobó con seis imágenes ficticias y respuestas simuladas de Supabase. El código del Worker se publicará después de integrar el PR.

## Finanzas

- La rama `finanzas-movimientos-reparto` modifica Resumen, Movimiento y Empleados. Los porcentajes vigentes se calculan con el neto de las modelos asignadas.
- El directorio usa OAuth de AgencyKey. La primera conexión se autoriza en **Finanzas → Empleados**. Las bajas se reflejan al consultar el directorio y conservan el historial.
- Se verificaron ESLint, 21 pruebas de JavaScript, la compilación y la prueba SQL con reversión sobre Supabase de pruebas.
- Supabase de pruebas tiene las migraciones `20261121223206` y `20261121223243`. Siguiente comprobación: autorizar AgencyKey con una cuenta con acceso al directorio completo y abrir Empleados.
- La prueba OAuth del PR #8 encontró un modo de redirección incompatible con Workers. El ajuste se verificó en el runtime local de Cloudflare. Pasaron ESLint y 22 pruebas.
