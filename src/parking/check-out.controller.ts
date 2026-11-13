import { Body, Controller, HttpCode, HttpException, Inject, Post, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { canonicalRequestId } from './check-in.rules.js';
import { canonicalCheckOut } from './check-out.rules.js';
import { CheckOutService, CheckOutUnavailable, ClockInconsistency } from './check-out.service.js';
import { GateAuthGuard, GateRequest, REQUIRED_GATE_ROLE } from './gate-auth.guard.js';
import { isTransientDatabaseFailure } from '../database/errors.js';
import { apiError, rawHeaderValues } from '../http-utils.js';

@Controller('check-out')
@SetMetadata(REQUIRED_GATE_ROLE, 'EXIT')
@UseGuards(GateAuthGuard)
export class CheckOutController {
  constructor(@Inject(CheckOutService) private readonly checkOut: CheckOutService) {}
  @Post()
  @HttpCode(200)
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
      payload = canonicalCheckOut(body);
    } catch { throw apiError(400, 'INVALID_REQUEST', 'Invalid check-out request.'); }
    try {
      const outcome = await this.checkOut.execute(request.gate.buildingId, requestId, payload);
      if (outcome.status !== 200) throw new HttpException(outcome.body as object, outcome.status);
      return outcome.body;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof ClockInconsistency) throw apiError(500, 'CLOCK_INCONSISTENCY', 'Checkout time precedes check-in or is invalid.');
      const driver = error instanceof Error && error.cause ? error.cause : error;
      const code = (driver as { code?: string })?.code;
      if (error instanceof CheckOutUnavailable || isTransientDatabaseFailure(error) || code === '40001' || code === '40P01') {
        throw apiError(503, 'CHECK_OUT_TEMPORARILY_UNAVAILABLE', 'Check-out is temporarily unavailable. Retry with the same request ID.');
      }
      throw apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  }
}
