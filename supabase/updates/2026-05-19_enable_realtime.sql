-- Habilita Supabase Realtime para todas las tablas relevantes del usuario.
-- Esto permite que el cliente se suscriba a cambios (INSERT/UPDATE/DELETE)
-- vía WebSocket y reciba updates instantáneamente en otros dispositivos.
--
-- Forma idempotente: solo agrega tablas que aún no estén en la publication.

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'bolsillos',
    'gastos',
    'ingresos',
    'transferencias',
    'obligaciones',
    'deudas',
    'pagos_obligaciones',
    'pagos_deudas',
    'cierres_mensuales',
    'categorias',
    'reglas_aprendizaje',
    'provisiones',
    'metas',
    'configuracion'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Solo si la tabla existe
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      -- Solo si no está ya en la publication
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Asegura REPLICA IDENTITY FULL para que los eventos DELETE contengan
-- los datos completos del row antes de borrarse (útil para sync).
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'bolsillos','gastos','ingresos','transferencias','obligaciones',
    'deudas','pagos_obligaciones','pagos_deudas','cierres_mensuales',
    'categorias','reglas_aprendizaje','provisiones','metas','configuracion'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END $$;
