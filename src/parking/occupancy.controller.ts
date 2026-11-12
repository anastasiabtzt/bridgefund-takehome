import { Controller, Get, Header, HttpException, Inject, Query } from '@nestjs/common';
import { OccupancyService } from './occupancy.service.js';

// Drizzle wraps driver errors in cause; inspect codes, never error-message text.
export function isTransientDatabaseFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && (
      /^08[0-9A-Z]{3}$/.test(code)
      || ['53300', '57P01', '57P02', '57P03', '57014', '55P03',
        'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)
    )) return true;
    error = cause;
  }
  return false;
}

function failure(status: number, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

@Controller('occupancy')
export class OccupancyController {
  constructor(@Inject(OccupancyService) private readonly occupancy: OccupancyService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async read(@Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw failure(400, 'INVALID_REQUEST', 'Query parameters are not supported.');
    try {
      return await this.occupancy.read();
    } catch (error) {
      if (isTransientDatabaseFailure(error)) {
        throw failure(503, 'OCCUPANCY_TEMPORARILY_UNAVAILABLE', 'Occupancy is temporarily unavailable.');
      }
      throw failure(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  }
}
