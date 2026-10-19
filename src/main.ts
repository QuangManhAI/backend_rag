import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Global DTO Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS for frontend
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  app.enableCors({
    origin: [frontendOrigin, 'http://localhost:3000', 'http://127.0.0.1:5173'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // OpenAPI / Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Scientific Literature RAG API')
    .setDescription(
      'Hardware-accelerated (NVIDIA CUDA / Apple Metal) Retrieval-Augmented Generation API over 913,205 scientific paper chunks with co-authorship PageRank hybrid reranking and local Qwen2.5-7B GGUF inference.',
    )
    .setVersion('1.0.0')
    .addTag('Scientific RAG', 'Endpoints for semantic literature search, graph reranking, and grounded LLM synthesis')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Scientific RAG Backend — OpenAPI Specification',
  });

  const port = process.env.GATEWAY_PORT || process.env.PORT || 8000;
  await app.listen(port);
  logger.log(`Scientific RAG Backend server listening on port ${port}`);
  logger.log(`Swagger UI Documentation: http://localhost:${port}/api/docs`);
  logger.log(`OpenAPI JSON Schema: http://localhost:${port}/api/docs-json`);
  logger.log(`Health endpoint: http://localhost:${port}/api/rag/health`);
  logger.log(`Chat endpoint: http://localhost:${port}/api/rag/chat`);
}
bootstrap();
