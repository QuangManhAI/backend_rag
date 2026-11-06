import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../types/auth-user';
import { ChatSessionsService } from './chat-sessions.service';
import { sessionLinks, WithLinks } from '../common/hateoas';
import { BatchIdsQueryDto } from '../common/pagination';
import {
  ListMessagesQueryDto,
  ListSessionsQueryDto,
  MessagePageDto,
  RenameSessionDto,
  SessionDto,
  SessionPageDto,
  SessionSummaryDto,
} from './dto/chat-session.dto';

@ApiTags('Chat sessions')
@ApiBearerAuth()
@Controller('chat-sessions')
@UseGuards(JwtAuthGuard)
export class ChatSessionsController {
  constructor(private readonly sessions: ChatSessionsService) {}

  @Get()
  @WithLinks({ item: (s: SessionSummaryDto) => sessionLinks(s.id) })
  @ApiOkResponse({ type: SessionPageDto })
  list(
    @Query() q: ListSessionsQueryDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionPageDto> {
    return this.sessions.list(me.id, q);
  }

  @Get(':id')
  @WithLinks({ resource: (s: SessionDto) => sessionLinks(s.id) })
  @ApiOkResponse({ type: SessionDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  get(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionDto> {
    return this.sessions.get(me.id, id);
  }

  @Get(':id/messages')
  @WithLinks({
    resource: (_: unknown, req) => ({
      session: { href: req.originalUrl.split('/messages')[0] },
    }),
  })
  @ApiOkResponse({ type: MessagePageDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  listMessages(
    @Param('id') id: string,
    @Query() q: ListMessagesQueryDto,
    @CurrentUser() me: AuthUser,
  ): Promise<MessagePageDto> {
    return this.sessions.listMessages(me.id, id, q);
  }

  @Patch(':id')
  @WithLinks({ resource: (s: SessionSummaryDto) => sessionLinks(s.id) })
  @ApiOkResponse({ type: SessionSummaryDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  rename(
    @Param('id') id: string,
    @Body() dto: RenameSessionDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionSummaryDto> {
    return this.sessions.rename(me.id, id, dto.title);
  }

  /** Batch delete: same guarantees as the single delete, for at most 50 ids. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Always 204, also for repeated calls' })
  removeMany(
    @Query() q: BatchIdsQueryDto,
    @CurrentUser() me: AuthUser,
  ): Promise<void> {
    return this.sessions.removeMany(me.id, q.ids);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Always 204, also for repeated calls' })
  remove(@Param('id') id: string, @CurrentUser() me: AuthUser): Promise<void> {
    return this.sessions.remove(me.id, id);
  }
}
