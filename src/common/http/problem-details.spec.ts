import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { toProblemDetails } from './problem-details';

describe('toProblemDetails (RFC 9457)', () => {
  const fakeReq = (path = '/api/v2/chat-sessions') =>
    ({
      id: '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b10',
      path,
      url: path,
      originalUrl: path,
    }) as unknown as Request;

  it('formats NotFoundException with RFC 9457 structure', () => {
    const err = new NotFoundException('session not found');
    const problem = toProblemDetails(err, fakeReq());
    expect(problem).toEqual({
      type: 'urn:rag:error:not-found',
      title: 'Not Found',
      status: 404,
      detail: 'session not found',
      instance: '/api/v2/chat-sessions',
      request_id: '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b10',
      timestamp: expect.any(String),
    });
  });

  it('formats custom machine-code errors (e.g. ConflictException)', () => {
    const err = new ConflictException({
      error: 'SELF_LOCKOUT_FORBIDDEN',
      message: 'Admin cannot lock their own account',
    });
    const problem = toProblemDetails(
      err,
      fakeReq('/api/v2/admin/users/123/status'),
    );
    expect(problem).toMatchObject({
      type: 'urn:rag:error:self-lockout-forbidden',
      title: 'Conflict',
      code: 'SELF_LOCKOUT_FORBIDDEN',
      status: 409,
      detail: 'Admin cannot lock their own account',
      instance: '/api/v2/admin/users/123/status',
    });
  });

  it('formats validation errors with invalid_params', () => {
    const err = new BadRequestException([
      'display_name must be longer than 1 character',
      'email must be an email',
    ]);
    const problem = toProblemDetails(err, fakeReq('/api/v2/users'));
    expect(problem.status).toBe(400);
    expect(problem.invalid_params).toEqual([
      {
        name: 'display_name',
        reason: 'display_name must be longer than 1 character',
      },
      {
        name: 'email',
        reason: 'email must be an email',
      },
    ]);
  });
});
