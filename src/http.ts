import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    let status = 500;
    let body: unknown = { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      const detail = typeof response === 'object' && response !== null && 'error' in response ? response.error : undefined;
      if (detail && typeof detail === 'object' && 'code' in detail) body = response;
      else if (status === 400) body = { error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } };
      else if (status === 415) body = { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Supported JSON encoding is required.' } };
      else if (status === 413) body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
    } else {
      const type = (error as { type?: unknown })?.type;
      if (type === 'entity.too.large') { status = 413; body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } }; }
      else if (type === 'entity.parse.failed') { status = 400; body = { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON.' } }; }
    }
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    response.status(status).json(body);
  }
}

export function configureHttp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '4kb' });
  app.useGlobalFilters(new ApiExceptionFilter());
}
