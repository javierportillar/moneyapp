# Supabase Data Model

## Acceso actual
- `usuarios`: login simple por `cedula` y `password`.
- `usuarios.typeuser`: define si el usuario es `admin` o `user`.
- No se usa `auth.users`.

## Backend activo del frontend
- El frontend ya no depende de `finance_snapshots` como fuente principal.
- La persistencia real ahora usa tablas en espanol relacionadas por `user_cedula -> usuarios.cedula`.

## Tablas principales
- `configuracion`: configuracion operativa por usuario.
- `categorias`: categorias configurables por usuario.
- `reglas_aprendizaje`: reglas aprendidas para clasificacion automatica.
- `bolsillos`: bolsillos internos.
- `ingresos`: ingresos.
- `gastos`: gastos.
- `transferencias`: transferencias entre bolsillos.
- `obligaciones`: obligaciones recurrentes.
- `pagos_obligaciones`: historial de cumplimiento mensual de obligaciones.
- `deudas`: deudas y saldo pendiente.
- `pagos_deudas`: cuotas y abonos extraordinarios.
- `cierres_mensuales`: cierres mensuales.
- `movimientos`: vista unificada de movimientos.

## Relaciones
- `usuarios 1 -> 1 configuracion`
- `usuarios 1 -> n categorias`
- `usuarios 1 -> n reglas_aprendizaje`
- `usuarios 1 -> n bolsillos`
- `usuarios 1 -> n ingresos`
- `usuarios 1 -> n gastos`
- `usuarios 1 -> n transferencias`
- `usuarios 1 -> n obligaciones`
- `usuarios 1 -> n deudas`
- `bolsillos 1 -> n ingresos / gastos / obligaciones / deudas`
- `deudas 1 -> n pagos_deudas`
- `obligaciones 1 -> n pagos_obligaciones`

## Notas
- `finance_snapshots` se deja solo como compatibilidad temporal o respaldo manual.
- Si quieres limpiar el modelo anterior, puedes dejar de usar `profiles`, `categories`, `pockets`, `expenses`, etc. heredadas del esquema basado en `auth.users`.
- La app actual ya deberia escribir y leer estas tablas en espanol cuando el frontend se alinee con el esquema final.

## Paso obligatorio
Ejecuta completo [schema.sql](/Users/javierportillarosero/Documents/PROG/personalApp/supabase/schema.sql) en Supabase antes de probar la app, para crear estas tablas y sus politicas.
