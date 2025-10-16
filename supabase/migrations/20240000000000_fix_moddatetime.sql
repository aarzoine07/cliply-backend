-- Define moddatetime() trigger helper if missing
CREATE OR REPLACE FUNCTION public.moddatetime()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
