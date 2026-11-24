-- El nombre de una tarea pasa de unico en toda la empresa a unico por departamento.
-- Correr ANTES de desplegar el codigo de la rama tareas-nuevas.
-- No toca datos: los nombres de hoy ya son unicos en toda la empresa, asi que
-- tambien lo son por departamento. Se puede correr dos veces sin problema.
BEGIN;
ALTER TABLE tareas DROP CONSTRAINT IF EXISTS tareas_nombre_key;
DROP INDEX IF EXISTS tareas_nombre_key;
CREATE UNIQUE INDEX IF NOT EXISTS tareas_id_departamento_nombre_key ON tareas (id_departamento, nombre);
COMMIT;
