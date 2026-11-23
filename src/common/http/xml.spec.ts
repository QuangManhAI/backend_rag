import {
  BadRequestException,
  NotAcceptableException,
  UnsupportedMediaTypeException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { lastValueFrom, of } from 'rxjs';
import {
  ContentNegotiationInterceptor,
  parseXmlBody,
  toXml,
  UNSUPPORTED_BODY,
  unsupportedBody,
  wantsXml,
  xmlBodyMiddleware,
} from './xml';

describe('XML negotiation & XXE guard', () => {
  it('parses valid XML objects, coerces whitelisted booleans and roles array, and handles empty root', () => {
    const parsed = parseXmlBody(
      '<request><query>LoRA</query><expand_query>true</expand_query><use_authority_boost>false</use_authority_boost><roles>admin</roles><top_k>5</top_k></request>',
    );
    expect(parsed).toEqual({
      query: 'LoRA',
      expand_query: true,
      use_authority_boost: false,
      roles: ['admin'],
      top_k: '5',
    });

    expect(parseXmlBody('<empty></empty>')).toEqual({});
  });

  it('rejects XXE DOCTYPE/ENTITY, malformed XML, and primitive roots with 400 invalid xml', () => {
    expect(() =>
      parseXmlBody(
        '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r/>',
      ),
    ).toThrow(BadRequestException);
    expect(() => parseXmlBody('<unclosed>')).toThrow(BadRequestException);
    expect(() => parseXmlBody('<a>1</a><b>2</b>')).toThrow(BadRequestException);
    expect(() => parseXmlBody('<root>just text</root>')).toThrow(
      BadRequestException,
    );
  });

  it('detects unsupported Content-Type and XML Accept preferences', () => {
    expect(UNSUPPORTED_BODY()).toBeInstanceOf(UnsupportedMediaTypeException);

    const textReq = {
      method: 'POST',
      headers: { 'content-length': '12', 'content-type': 'text/plain' },
    } as unknown as Request;
    expect(unsupportedBody(textReq)).toBe(true);

    const jsonReq = {
      method: 'POST',
      headers: { 'content-length': '12', 'content-type': 'application/json' },
    } as unknown as Request;
    expect(unsupportedBody(jsonReq)).toBe(false);

    const xmlAcceptReq = {
      accepts: jest.fn().mockReturnValue('application/xml'),
    } as unknown as Request;
    expect(wantsXml(xmlAcceptReq)).toBe(true);
    expect(toXml({ ok: true })).toContain('<response><ok>true</ok></response>');
  });

  it('xmlBodyMiddleware parses string bodies and forwards errors via sendError callback', () => {
    const next = jest.fn();
    const sendError = jest.fn();
    const mw = xmlBodyMiddleware(sendError);

    const nonStringReq = { body: { already: 'json' } } as unknown as Request;
    mw(nonStringReq, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    const validReq = { body: '<req><q>hello</q></req>' } as unknown as Request;
    mw(validReq, {} as Response, next);
    expect(validReq.body).toEqual({ q: 'hello' });
    expect(next).toHaveBeenCalledTimes(2);

    const badReq = { body: '<bad' } as unknown as Request;
    mw(badReq, {} as Response, next);
    expect(sendError).toHaveBeenCalledTimes(1);
    expect(sendError.mock.calls[0][2]).toBeInstanceOf(BadRequestException);
  });

  it('ContentNegotiationInterceptor throws 406 on unacceptable Accept and converts object responses to XML', async () => {
    const interceptor = new ContentNegotiationInterceptor();
    const typeSpy = jest.fn();
    const makeCtx = (accepted: string | false) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ accepts: () => accepted }),
          getResponse: () => ({ type: typeSpy }),
        }),
      }) as unknown as ExecutionContext;

    const handler: CallHandler = { handle: () => of({ status: 'ok' }) };

    expect(() => interceptor.intercept(makeCtx(false), handler)).toThrow(
      NotAcceptableException,
    );

    const xmlOut = await lastValueFrom(
      interceptor.intercept(makeCtx('application/xml'), handler),
    );
    expect(typeSpy).toHaveBeenCalledWith('application/xml');
    expect(String(xmlOut)).toContain(
      '<response><status>ok</status></response>',
    );
  });
});
