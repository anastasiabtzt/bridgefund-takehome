import { Body, Controller, HttpException, Inject, Post, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { canonicalCheckIn, canonicalRequestId } from './check-in.rules.js';
import { CheckInService, CheckInUnavailable } from './check-in.service.js';
import { apiError, GateAuthGuard, GateRequest, rawHeaderValues, REQUIRED_GATE_ROLE } from './gate-auth.guard.js';
import { isTransientDatabaseFailure } from './occupancy.controller.js';

@Controller('check-in')
@SetMetadata(REQUIRED_GATE_ROLE, 'ENTRANCE')
@UseGuards(GateAuthGuard)
export class CheckInController {
  constructor(@Inject(CheckInService) private readonly checkIn: CheckInService) {}
  @Post()
  async execute(@Req() request: GateRequest, @Body() body: unknown) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      throw apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
    }
    let payload;
    let requestId;
    try {
      const headers = rawHeaderValues(request, 'x-request-id');
      if (headers.length !== 1) throw new Error();
      requestId = canonicalRequestId(headers[0]);
      payload = canonicalCheckIn(body);
    } catch { throw apiError(400, 'INVALID_REQUEST', 'Invalid check-in request.'); }
    try {
      const outcome = await this.checkIn.execute(request.gate.buildingId, requestId, payload);
      if (outcome.status !== 201) throw new HttpException(outcome.body as object, outcome.status);
      return outcome.body;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const driver = error instanceof Error && error.cause ? error.cause : error;
      const code = (driver as { code?: string })?.code;
      const constraint = (driver as { constraint?: string })?.constraint;
      if (error instanceof CheckInUnavailable || isTransientDatabaseFailure(error)
        || code === '40001' || code === '40P01'
        || (code === '23505' && constraint === 'one_active_allocation_per_space')) {
        throw apiError(503, 'CHECK_IN_TEMPORARILY_UNAVAILABLE', 'Check-in is temporarily unavailable. Retry with the same request ID.');
      }
      throw apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  }
}
