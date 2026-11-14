import { Controller, Get, Header, HttpException, Inject, Query } from '@nestjs/common';
import { isTransientDatabaseFailure } from '../database/errors.js';
import { OccupancyService, OccupancyUnavailable } from './occupancy.service.js';

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
      if (error instanceof OccupancyUnavailable || isTransientDatabaseFailure(error)) {
        throw failure(503, 'OCCUPANCY_TEMPORARILY_UNAVAILABLE', 'Occupancy is temporarily unavailable.');
      }
      throw failure(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  }
}
