import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter, toErrorBody } from './http-exception.filter';

describe('toErrorBody', () => {
  it('keeps the message of an HttpException', () => {
    expect(
      toErrorBody(new NotFoundException('session not found'), 'rid'),
    ).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'session not found',
      request_id: 'rid',
    });
  });

  it('uses the first message of an array response', () => {
    const e = new BadRequestException(['query should not be empty', 'other']);
    expect(toErrorBody(e, null).message).toBe('query should not be empty');
  });

  it('turns unknown errors into a 500 without details', () => {
    expect(toErrorBody(new Error('db password leaked'), 'rid')).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'internal server error',
      request_id: 'rid',
    });
  });
});

describe('HttpExceptionFilter', () => {
  function host(headersSent = false) {
    const res = {
      headersSent,
      err: undefined as unknown,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    const req = { id: 'rid', accepts: () => 'application/json' };
    const h = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
    return { h, res };
  }

  it('sends the §1.2 body', () => {
    const { h, res } = host();
    new HttpExceptionFilter().catch(
      new NotFoundException('paper not found'),
      h,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'paper not found',
        request_id: 'rid',
      }),
    );
    expect(res.err).toBeUndefined();
  });

  it('attaches unexpected errors for the log line', () => {
    const { h, res } = host();
    const err = new Error('boom');
    new HttpExceptionFilter().catch(err, h);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.err).toBe(err);
  });

  it('only ends the response when headers are already sent', () => {
    const { h, res } = host(true);
    new HttpExceptionFilter().catch(new Error('mid-stream'), h);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
