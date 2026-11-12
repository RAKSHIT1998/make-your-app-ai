import type { OrgRole, PlatformRole } from '@mya/db';

export interface AuthUser {
  id: string;
  email: string;
  platformRole: PlatformRole;
  personalOrgId: string;
}

export const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
