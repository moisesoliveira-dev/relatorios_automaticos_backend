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
  // Em produção, defina FRONTEND_URL com a URL do seu frontend no Railway
  const allowedOrigins = [
    'http://localhost:4200',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  // Escuta em 0.0.0.0 para funcionar dentro de containers
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📚 API disponível em /api`);
}
bootstrap();
