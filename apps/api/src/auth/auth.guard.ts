import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from './decorators.js';
import { TokenVerifier } from './token-verifier.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      // Public routes still recognise a signed-in caller (e.g. "liked by me"); a bad token is ignored, never trusted.
      if (header?.startsWith('Bearer ')) {
        try {
          req.user = await this.auth.resolveUser(await this.verifier.verify(header.slice(7)), req.ip ?? null);
        } catch {
          /* anonymous */
        }
      }
      return true;
    }
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    let claims;
    try {
      claims = await this.verifier.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = await this.auth.resolveUser(claims, req.ip ?? null);
    return true;
  }
}
