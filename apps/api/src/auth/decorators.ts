import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});

/** The signed-in caller on a public route, or null for anonymous visitors. */
export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | null => ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user ?? null);
