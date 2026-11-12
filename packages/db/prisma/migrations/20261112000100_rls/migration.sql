-- Row Level Security — defence in depth behind API authorization.
-- The API connects as the table owner (bypasses RLS). Any client that talks to Postgres
-- directly with a Supabase JWT (roles anon/authenticated) only sees rows these policies allow.
-- Tables holding secrets or platform config have RLS enabled and NO policies => deny all.

CREATE OR REPLACE FUNCTION mya_uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

CREATE OR REPLACE FUNCTION mya_is_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM "OrganizationMembership" m
    WHERE m."organizationId" = org AND m."userId" = mya_uid()
  )
$$;

CREATE OR REPLACE FUNCTION mya_can_see_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Project" p
    JOIN "OrganizationMembership" m ON m."organizationId" = p."organizationId"
    WHERE p.id = pid AND m."userId" = mya_uid() AND p."deletedAt" IS NULL
  )
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Organization','OrganizationMembership','Plan','Subscription','CreditLedgerEntry',
    'Project','ProjectFile','ProjectVersion','GenerationRun','AgentTask','AgentEvent',
    'AiProviderConfig','AiUsage','BuildJob','BuildArtifact','Domain','HostingDeployment',
    'Integration','DeveloperAccount','PublishingRecord','ApprovalRequest','AuditLog',
    'Notification','SupportRequest'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Read-only policies for directly-connected clients
CREATE POLICY user_self ON "User" FOR SELECT USING (id = mya_uid());
CREATE POLICY org_member ON "Organization" FOR SELECT USING (mya_is_member(id));
CREATE POLICY membership_member ON "OrganizationMembership" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY plan_public ON "Plan" FOR SELECT USING (active);
CREATE POLICY sub_member ON "Subscription" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY ledger_member ON "CreditLedgerEntry" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY usage_member ON "AiUsage" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY project_member ON "Project" FOR SELECT USING (mya_is_member("organizationId") AND "deletedAt" IS NULL);
CREATE POLICY pfile_member ON "ProjectFile" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY pver_member ON "ProjectVersion" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY run_member ON "GenerationRun" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY task_member ON "AgentTask" FOR SELECT USING (EXISTS (SELECT 1 FROM "GenerationRun" r WHERE r.id = "generationRunId" AND mya_can_see_project(r."projectId")));
CREATE POLICY event_member ON "AgentEvent" FOR SELECT USING (EXISTS (SELECT 1 FROM "GenerationRun" r WHERE r.id = "generationRunId" AND mya_can_see_project(r."projectId")));
CREATE POLICY build_member ON "BuildJob" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY artifact_member ON "BuildArtifact" FOR SELECT USING (EXISTS (SELECT 1 FROM "BuildJob" b WHERE b.id = "buildJobId" AND mya_can_see_project(b."projectId")));
CREATE POLICY domain_member ON "Domain" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY deploy_member ON "HostingDeployment" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY publish_member ON "PublishingRecord" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY approval_member ON "ApprovalRequest" FOR SELECT USING (mya_can_see_project("projectId"));
CREATE POLICY notif_self ON "Notification" FOR SELECT USING ("userId" = mya_uid());
CREATE POLICY support_self ON "SupportRequest" FOR SELECT USING ("userId" = mya_uid());
-- Integration, DeveloperAccount, AiProviderConfig, AuditLog: no policies => no direct client access.
