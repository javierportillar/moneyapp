# Esquema Final

## Enfoque
- Arquitectura transaccional normalizada.
- Tablas en espanol.
- Relaciones internas por `usuario_id` UUID.
- `app_id` se conserva como identificador estable del frontend por entidad.
- Con RLS.
- Sin Supabase Auth de usuarios finales.
- Sesion propia mediante tabla `sesiones` y header `x-app-session`.

## Tablas
- `usuarios`
- `sesiones`
- `configuracion`
- `categorias`
- `reglas_aprendizaje`
- `bolsillos`
- `ingresos`
- `gastos`
- `transferencias`
- `obligaciones`
- `pagos_obligaciones`
- `deudas`
- `pagos_deudas`
- `cierres_mensuales`
- `movimientos` (vista)

## Criterio de modelado
- `id`: clave primaria tecnica en la base de datos.
- `app_id`: id estable que usa el frontend para rehidratar y editar registros.
- `usuario_id`: clave foranea comun para todo el dominio.
- `cedula` y `username`: datos de negocio del usuario; no se usan como PK relacional del dominio.

## Seguridad
- Las tablas del dominio quedan protegidas por RLS.
- El acceso se filtra con `public.usuario_actual_id()` a partir del header `x-app-session`.
- Las funciones `iniciar_sesion_simple`, `registrar_usuario_simple`, `cerrar_sesion_simple` y `usuario_actual_simple` son `security definer` y son la puerta de entrada para la sesion simple.
- Este enfoque es util para una etapa inicial, pero sigue siendo menos robusto que Supabase Auth o un backend propio porque la aplicacion sigue consumiendo el Data API desde el navegador.

## Importante
- El archivo [schema.sql](/Users/javierportillarosero/Documents/PROG/personalApp/supabase/schema.sql) elimina primero tablas y vistas legacy en ingles y luego crea un unico esquema final en espanol.
- Debes ejecutar ese archivo completo en Supabase para dejar la base alineada con el frontend actual.
