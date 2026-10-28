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
import {
  ListSessionsQueryDto,
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
  @ApiOkResponse({ type: SessionPageDto })
  list(
    @Query() q: ListSessionsQueryDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionPageDto> {
    return this.sessions.list(me.id, q.cursor, q.q);
  }

  @Get(':id')
  @ApiOkResponse({ type: SessionDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  get(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionDto> {
    return this.sessions.get(me.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SessionSummaryDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  rename(
    @Param('id') id: string,
    @Body() dto: RenameSessionDto,
    @CurrentUser() me: AuthUser,
  ): Promise<SessionSummaryDto> {
    return this.sessions.rename(me.id, id, dto.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Always 204, also for repeated calls' })
  remove(@Param('id') id: string, @CurrentUser() me: AuthUser): Promise<void> {
    return this.sessions.remove(me.id, id);
  }
}
