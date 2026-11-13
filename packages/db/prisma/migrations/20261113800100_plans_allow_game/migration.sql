-- Existing plans get the new project type once; admins can still remove it in Owner console -> Plans.
UPDATE "Plan" SET "projectTypes" = array_append("projectTypes", 'game') WHERE NOT ('game' = ANY("projectTypes"));
