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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { chatLinksV2, WithLinks } from '../../../common/http/hateoas';
import { toProblemDetails } from '../../../common/http/problem-details';
import { logEvent } from '../../../common/logging/request-context';
import { RateLimitChat } from '../../../common/security/throttler';
import { isUuid } from '../../../common/utils/uuid';
import { AbortedError } from '../../../engines/llm/llm-queue';
import type { AuthUser } from '../../../types/auth-user';
import { ChatRequestDto } from '../dto/chat-request.dto';
import { ChatResponseDto } from '../dto/chat-response.dto';
import { RagService } from '../rag.service';
import type { PipelineEvent, PipelineResult } from '../rag.types';
import { ClientSlots, TOO_MANY_INFLIGHT } from '../transport/client-slots';
import { abortOnClientClose, SseWriter } from '../transport/sse';

const CLIENT_CLOSED = 499;

function statusOf(e: unknown): number {
  return e instanceof HttpException ? e.getStatus() : 500;
}

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
@RateLimitChat()
@Controller('api/v2/rag')
@UseGuards(OptionalJwtAuthGuard)
export class RagV2Controller {
  private readonly slots = new ClientSlots();

  constructor(private readonly rag: RagService) {}

  private acquireSlot(req: Request, user: AuthUser | undefined): () => void {
    const release = this.slots.acquire(req.ip, user?.id);
    if (!release) {
      logEvent('CHAT_TOO_MANY_INFLIGHT');
      throw new HttpException(TOO_MANY_INFLIGHT, HttpStatus.TOO_MANY_REQUESTS);
    }
    return release;
  }

  /** Synchronous scientific question answering (REST queries). */
  @Post(['queries', 'chat'])
  @WithLinks({ resource: (r: ChatResponseDto) => chatLinksV2(r) })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ChatResponseDto })
  @ApiTooManyRequestsResponse({ description: 'llm queue is full' })
  @ApiServiceUnavailableResponse({
    description: 'qdrant unavailable / llm unavailable',
  })
  async query(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChatResponseDto> {
    const key = parseIdempotencyKey(rawKey);
    const release = this.acquireSlot(req, user);
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
    } finally {
      release();
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
      ...(r.quality ? { quality: r.quality } : {}),
    };
  }

  /** Server-Sent Events stream: `phase` ➔ `route` ➔ `compare` ➔ `retrieval` ➔ `token`… ➔ `done` | `error`. */
  @Post(['queries/stream', 'chat/stream'])
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'text/event-stream of RagStreamEvent',
  })
  async stream(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: AuthUser | undefined,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = parseIdempotencyKey(rawKey);
    const release = this.acquireSlot(req, user);
    const t0 = performance.now();
    const ctrl = abortOnClientClose(res, 'CHAT_STREAM_ABORTED');
    const result: Partial<PipelineResult> = {};
    const events = this.rag.run(dto, user, ctrl.signal, result, t0, key);
    let r: IteratorResult<PipelineEvent>;
    try {
      r = await events.next();
    } catch (e) {
      release();
      logEvent('CHAT_FAILED', { error_status: statusOf(e) });
      throw e;
    }

    if (result.replayed) res.setHeader(REPLAYED_HEADER, 'true');
    const sse = new SseWriter(res);
    sse.open();
    try {
      while (!r.done) {
        if (ctrl.signal.aborted) throw new AbortedError();
        sse.send(
          r.value.type === 'done'
            ? { ...r.value, _links: chatLinksV2(r.value) }
            : r.value,
        );
        r = await events.next();
      }
      logEvent('CHAT_STREAM_OK');
    } catch (e) {
      if (e instanceof AbortedError || ctrl.signal.aborted) {
        logEvent('CHAT_STREAM_ABORTED');
      } else {
        const problem = toProblemDetails(e, req);
        sse.send({
          type: 'error',
          message: problem.detail,
          status: problem.status,
        });
        logEvent('CHAT_FAILED', { error_status: problem.status });
        if (!(e instanceof HttpException)) {
          (res as Response & { err?: Error }).err =
            e instanceof Error ? e : new Error(String(e));
        }
      }
    } finally {
      try {
        await events.return(undefined);
      } finally {
        release();
        sse.close();
      }
    }
  }
}
