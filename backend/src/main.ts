import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { HttpExceptionFilter } from './app/filters/http-exception.filter';
import {
  isSwaggerEnabled,
  buildCspDirectives,
  parseTrustProxy,
} from './app/common/security-config.util';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api/v1';
  app.setGlobalPrefix(globalPrefix);

  // HTTP response compression. Negotiates Brotli (br) when the client
  // supports it, otherwise falls back to gzip. Responses under 1 KB are
  // sent uncompressed (overhead exceeds benefit at that size).
  app.use(compression({ threshold: 1024 }));

  // SEC-W5: Swagger is gated (below); its UI needs inline scripts/styles, so the
  // looser CSP is used only when Swagger is mounted. Production (Swagger off, API
  // JSON only — the SPA is a separate host) gets a strict CSP with no unsafe-inline.
  const swaggerEnabled = isSwaggerEnabled(process.env);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: buildCspDirectives(swaggerEnabled),
      },
    }),
  );

  // CORS configuration
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [process.env.FRONTEND_URL || 'http://localhost:4200'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // SEC-W9: configurable trust-proxy so client-supplied X-Forwarded-For cannot be
  // spoofed. Defaults to trusting exactly ONE hop (non-spoofable) when TRUST_PROXY
  // is unset; production should set TRUST_PROXY to the exact hop count / proxy CIDR
  // matching its real reverse-proxy chain (nginx / ALB / Cloudflare).
  try {
    (app as any).set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
  } catch (err) {
    // older Nest/Express versions may not expose set; ignore if unavailable
  }

  // Global middleware to record request start time for response-time logging
  app.use((req: any, res: any, next: () => void) => {
    req.startTime = Date.now();
    next();
  });

  // Register global filter and validation pipes
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // SEC-W5: only expose the Swagger `/docs` UI outside production (or when an
  // operator explicitly opts in via ENABLE_SWAGGER). No new auth system is added.
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('FinMate API')
      .setDescription('FinMate Backend API Specification')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
