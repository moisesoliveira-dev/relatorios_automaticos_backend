import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validação global de DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Prefixo global da API
  app.setGlobalPrefix('api');

  // Habilita CORS para o frontend
  app.enableCors({
    origin: ['http://localhost:4200', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 Servidor rodando em http://localhost:${process.env.PORT ?? 3000}`);
  console.log(`📚 API disponível em http://localhost:${process.env.PORT ?? 3000}/api`);
}
bootstrap();
