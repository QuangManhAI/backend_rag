import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatSessionsController } from './chat-sessions.controller';
import { ChatSessionsService } from './chat-sessions.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { ChatSession, ChatSessionSchema } from './schemas/chat-session.schema';
import { SESSION_STORE } from './session-store.port';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
  ],
  controllers: [ChatSessionsController],
  providers: [
    ChatSessionsService,
    { provide: SESSION_STORE, useExisting: ChatSessionsService },
  ],
  exports: [SESSION_STORE, MongooseModule],
})
export class ChatSessionsModule {}
