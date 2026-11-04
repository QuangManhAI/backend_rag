import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { requestIdOf } from '../common/request-context';
import type { AuditRequest } from './admin-audit.service';

/** Who and where an admin action comes from, as recorded in the audit trail. */
export const AuditContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuditRequest => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return { ip: req.ip, id: requestIdOf(req) ?? undefined };
  },
);
