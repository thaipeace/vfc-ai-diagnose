import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// Suppress transient socket reset logs from DB idle connection drops
process.on('uncaughtException', (err: any) => {
  if (
    err?.code === 'ECONNRESET' ||
    err?.message?.includes('ECONNRESET') ||
    err?.syscall === 'read'
  ) {
    return;
  }
  console.error('[UncaughtException]', err);
});

process.on('unhandledRejection', (reason: any) => {
  if (
    reason?.code === 'ECONNRESET' ||
    reason?.message?.includes('ECONNRESET') ||
    reason?.syscall === 'read'
  ) {
    return;
  }
  console.error('[UnhandledRejection]', reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Enable CORS
  app.enableCors({
    origin: true, // Allow requests from any frontend domain / Vercel
    credentials: true,
  });

  // Increase payload limit for base64 images
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // Use Pino logger
  app.useLogger(app.get(Logger));

  // Global exception filter and interceptor
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Global prefix for all API routes (except root /)
  app.setGlobalPrefix('api/v1', {
    exclude: ['/'],
  });

  // Root endpoint for Render / Cloud health check
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (req: any, res: any) => {
    res.json({
      status: 'ok',
      service: 'vfc-ai-diagnose',
      docs: '/api/docs',
      health: '/api/v1/health',
      timestamp: new Date().toISOString(),
    });
  });
  expressApp.head('/', (req: any, res: any) => {
    res.status(200).end();
  });

  // Swagger OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('VFC AI Diagnosis Microservice')
    .setDescription(
      'Microservice API for plant disease detection and product recommendations',
    )
    .setVersion('1.0')
    .addTag('diagnoses')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API server running at http://localhost:${port}`);
  console.log(`📚 Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
