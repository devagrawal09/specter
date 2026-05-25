UPDATE `slice_cursors`
SET `slice_name` = 'todosQuery'
WHERE `slice_name` = 'todosProjection'
  AND NOT EXISTS (
    SELECT 1 FROM `slice_cursors` WHERE `slice_name` = 'todosQuery'
  );
--> statement-breakpoint
DELETE FROM `slice_cursors`
WHERE `slice_name` = 'todosProjection'
  AND EXISTS (
    SELECT 1 FROM `slice_cursors` WHERE `slice_name` = 'todosQuery'
  );
