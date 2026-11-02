import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Erros HTTP esperados (400/401/403/404...) passam como estão.
 * Qualquer outro erro vira 500 genérico — detalhes internos só vão para o log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }

    this.logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno do servidor',
    });
  }
}
