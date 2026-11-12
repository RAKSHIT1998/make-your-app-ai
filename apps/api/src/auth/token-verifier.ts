import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config.js';

export interface VerifiedClaims {
  sub: string;
  email: string;
}

/**
 * Verifies Supabase Auth access tokens.
 * - Asymmetric signing keys (RS256/ES256): verified against the project's JWKS endpoint.
 * - Legacy HS256 projects: verified with SUPABASE_JWT_SECRET.
 */
@Injectable()
export class TokenVerifier {
  private readonly jwks;
  private readonly secret;
  private readonly issuer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.issuer = config.SUPABASE_URL ? `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined;
    this.jwks = this.issuer ? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`)) : undefined;
    this.secret = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : undefined;
  }

  async verify(token: string): Promise<VerifiedClaims> {
    const { alg } = decodeProtectedHeader(token);
    const options = { audience: 'authenticated', ...(this.issuer ? { issuer: this.issuer } : {}) };
    let payload: JWTPayload;
    if (alg === 'HS256') {
      if (!this.secret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not configured');
      ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] }));
    } else {
      if (!this.jwks) throw new Error('Asymmetric token but SUPABASE_URL is not configured');
      ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ['RS256', 'ES256'] }));
    }
    if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
      throw new Error('Token missing sub/email');
    }
    return { sub: payload.sub, email: payload['email'] };
  }
}
