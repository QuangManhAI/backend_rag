import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { TokenService, UNAUTHORIZED } from '../token.service';

/** `Bearer <token>` ➔ token; no header ➔ null; any other shape ➔ 401. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header === undefined) return null;
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  if (!m) throw new UnauthorizedException(UNAUTHORIZED);
  return m[1];
}

/** JWT required: attaches `req.user`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedException(UNAUTHORIZED);
    const claims = await this.tokens.verifyAccess(token);
    // The account state is checked on every request (cached 60 s): a disabled account or a token
    // issued before a permission change must stop working immediately (prompt_security S3).
    const user = await this.auth.getActiveUser(claims.id);
    if (!user || !user.is_active) throw new UnauthorizedException(UNAUTHORIZED);
    if ((user.token_version ?? 0) !== (claims.tokenVersion ?? 0)) {
      throw new UnauthorizedException(UNAUTHORIZED);
    }
    req.user = { id: user._id.toString(), roles: user.roles };
    return true;
  }
}

/** JWT optional: valid ➔ `req.user`; no token ➔ anonymous; invalid or expired ➔ 401. */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) return true;
    const claims = await this.tokens.verifyAccess(token);
    const user = await this.auth.getActiveUser(claims.id);
    if (!user || !user.is_active) throw new UnauthorizedException(UNAUTHORIZED);
    if ((user.token_version ?? 0) !== (claims.tokenVersion ?? 0)) {
      throw new UnauthorizedException(UNAUTHORIZED);
    }
    req.user = { id: user._id.toString(), roles: user.roles };
    return true;
  }
}
