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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../../../types/auth-user';
import { ChatSessionsService } from '../chat-sessions.service';
import { sessionLinksV2, WithLinks } from '../../../common/http/hateoas';
import { BatchIdsQueryDto } from '../../../common/pagination/pagination';
import {
  ListMessagesQueryDto,
  MessagePageDto,
  RenameSessionDto,
  SessionDto,
  SessionPageDto,
  SessionSummaryDto,
} from '../dto/chat-session.dto';
import { ListSessionsV2QueryDto } from './dto/chat-session.v2.dto';

@ApiTags('Chat sessions')
@ApiBearerAuth()
@Controller('api/v2/chat-sessions')
@UseGuards(JwtAuthGuard)
export class ChatSessionsV2Controller {
  constructor(private readonly sessions: ChatSessionsService) {}

  @Get()
  @WithLinks({ item: (s: SessionSummaryDto) => sessionLinksV2(s.id) })
  @ApiOkResponse({ type: SessionPageDto })
  list(
    @Query() q: ListSessionsV2QueryDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionPageDto> {
    return this.sessions.list(me.id, q.toLegacyQuery());
  }

  @Get(':id')
  @WithLinks({ resource: (s: SessionDto) => sessionLinksV2(s.id) })
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
  @WithLinks({ resource: (s: SessionSummaryDto) => sessionLinksV2(s.id) })
  @ApiOkResponse({ type: SessionSummaryDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  rename(
    @Param('id') id: string,
    @Body() dto: RenameSessionDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionSummaryDto> {
    return this.sessions.rename(me.id, id, dto.title);
  }

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

