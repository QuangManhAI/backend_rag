import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatRequestsService } from './chat-requests.service';
import { ChatSessionsController } from './chat-sessions.controller';
import { ChatSessionsV2Controller } from './v2/chat-sessions.v2.controller';
import { ChatSessionsService } from './chat-sessions.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { ChatRequest, ChatRequestSchema } from './schemas/chat-request.schema';
import { ChatSession, ChatSessionSchema } from './schemas/chat-session.schema';
import { SESSION_STORE } from './session-store.port';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatRequest.name, schema: ChatRequestSchema },
    ]),
  ],
  controllers: [ChatSessionsController, ChatSessionsV2Controller],
  providers: [
    ChatRequestsService,
    ChatSessionsService,
    { provide: SESSION_STORE, useExisting: ChatSessionsService },
  ],
  exports: [SESSION_STORE, MongooseModule],
})
export class ChatSessionsModule {}
