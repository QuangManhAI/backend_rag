import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { chatLinks, WithLinks } from '../common/hateoas';
import { toErrorBody } from '../common/http-exception.filter';
import { logEvent, requestIdOf } from '../common/request-context';
import { RateLimit } from '../common/throttler';
import { isUuid } from '../common/uuid';
import { AbortedError } from '../llm/llm-queue';
import type { AuthUser } from '../types/auth-user';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { PipelineEvent, PipelineResult, RagService } from './rag.service';
import { abortOnClientClose, SseWriter } from './sse';

const CLIENT_CLOSED = 499;

function statusOf(e: unknown): number {
  return e instanceof HttpException ? e.getStatus() : 500;
}

/** A client-generated UUID; anything else is a client bug, so it is rejected, not ignored. */
function parseIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!isUuid(raw)) throw new BadRequestException('invalid Idempotency-Key');
  return raw.toLowerCase();
}

const REPLAYED_HEADER = 'Idempotent-Replayed';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'UUID. With a JWT, repeating a finished request replays the stored answer for 24 h.',
};

@ApiTags('RAG')
@ApiBearerAuth()
@ApiHeader(IDEMPOTENCY_HEADER)
@ApiConflictResponse({
  description: 'request already in progress / key reused with another body',
})
@RateLimit('ragChat')
@Controller('rag')
@UseGuards(OptionalJwtAuthGuard)
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post('chat')
  @WithLinks({ resource: (r: ChatResponseDto) => chatLinks(r) })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ChatResponseDto })
  @ApiTooManyRequestsResponse({ description: 'llm queue is full' })
  @ApiServiceUnavailableResponse({
    description: 'qdrant unavailable / llm unavailable',
  })
  async chat(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChatResponseDto> {
    const key = parseIdempotencyKey(rawKey);
    const t0 = performance.now();
    const ctrl = abortOnClientClose(res, 'CHAT_ABORTED');
    const result: Partial<PipelineResult> = {};
    try {
      const events = this.rag.run(dto, user, ctrl.signal, result, t0, key);
      for await (const _ of events) {
        if (ctrl.signal.aborted) break;
      }
    } catch (e) {
      if (e instanceof AbortedError || ctrl.signal.aborted) {
        logEvent('CHAT_ABORTED');
        throw new HttpException('client closed request', CLIENT_CLOSED);
      }
      logEvent('CHAT_FAILED', { error_status: statusOf(e) });
      throw e;
    }
    if (ctrl.signal.aborted) {
      logEvent('CHAT_ABORTED');
      throw new HttpException('client closed request', CLIENT_CLOSED);
    }
    logEvent('CHAT_OK');
    const r = result as PipelineResult;
    if (r.replayed) res.setHeader(REPLAYED_HEADER, 'true');
    return {
      session_id: r.session_id,
      message_id: r.message_id,
      query: dto.query,
      answer: r.answer,
      citations: r.citations,
      grounded_chunks: r.grounded_chunks,
      expanded_terms: r.expanded_terms,
      timings: r.timings,
    };
  }

  /**
   * SSE: `phase` ➔ `route` ➔ `compare` ➔ `retrieval` ➔ `token`… ➔ `done` | `error`. A failure before the
   * first event is a normal HTTP error; after it, an `error` event replaces `done`.
   */
  @Post('chat/stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'text/event-stream of RagStreamEvent (API_DESIGN §3.1)',
  })
  async stream(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = parseIdempotencyKey(rawKey);
    const t0 = performance.now();
    const ctrl = abortOnClientClose(res, 'CHAT_STREAM_ABORTED');
    const result: Partial<PipelineResult> = {};
    const events = this.rag.run(dto, user, ctrl.signal, result, t0, key);
    let r: IteratorResult<PipelineEvent>;
    try {
      r = await events.next();
    } catch (e) {
      logEvent('CHAT_FAILED', { error_status: statusOf(e) });
      throw e; // headers not sent yet: the exception filter answers with HTTP status + §1.2 body
    }

    if (result.replayed) res.setHeader(REPLAYED_HEADER, 'true');
    const sse = new SseWriter(res);
    sse.open();
    try {
      while (!r.done) {
        if (ctrl.signal.aborted) throw new AbortedError();
        sse.send(
          r.value.type === 'done'
            ? { ...r.value, _links: chatLinks(r.value) }
            : r.value,
        );
        r = await events.next();
      }
      logEvent('CHAT_STREAM_OK');
    } catch (e) {
      if (e instanceof AbortedError || ctrl.signal.aborted) {
        logEvent('CHAT_STREAM_ABORTED');
      } else {
        const body = toErrorBody(e, requestIdOf(req));
        sse.send({
          type: 'error',
          message: body.message,
          status: body.statusCode,
        });
        logEvent('CHAT_FAILED', { error_status: body.statusCode });
        if (!(e instanceof HttpException)) {
          (res as Response & { err?: Error }).err =
            e instanceof Error ? e : new Error(String(e));
        }
      }
    } finally {
      await events.return(undefined);
      sse.close();
    }
  }
}
