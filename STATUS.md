# Estado de Hers-prueba

Entorno web de pruebas de HERS. El panel de administración incluye Finanzas e Integraciones.

- Fecha: 2026-11-20.
- Rama: `finanzas-pruebas`. [PR #1](https://github.com/Hers-NSB/Hers-prueba/pull/1).
- [Cloudflare de pruebas](https://hers-prueba.datosenviados07.workers.dev/). El disparador diario está configurado para las 11:00 UTC.
- Integraciones permite guardar credenciales cifradas y probar o ejecutar la sincronización de AgencyKey.
- Comprobaciones: compilación de Vite, diez pruebas de Node y validación en Supabase del acceso al RPC y de la respuesta sin secretos.
- El acceso de Administrador permite solicitar por correo un enlace y configurar la contraseña en `/restablecer-contrasena`. La ruta debe estar autorizada en Supabase → Authentication → URL Configuration.
- Siguiente paso: configurar la contraseña, guardar la clave de AgencyKey desde Integraciones y ejecutar **Probar conexión**. Sigue pendiente validar el origen público de los importes brutos y netos por modelo.
