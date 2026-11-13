import { Body, Controller, HttpCode, HttpException, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import { apiError } from '../http-utils.js';
import { isTransientDatabaseFailure } from '../database/errors.js';
import { paymentFailureDiagnostic } from './payment-failure-diagnostic.js';
import { canonicalPayment } from './payment.rules.js';
import { PaymentSignatureGuard } from './payment-signature.guard.js';
import { PaymentService, PaymentUnavailable } from './payment.service.js';

@Controller('webhooks/payments')
@UseGuards(PaymentSignatureGuard)
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);
  constructor(@Inject(PaymentService) private readonly payments: PaymentService) {}
  @Post()
  @HttpCode(204)
  async receive(@Body() body: unknown): Promise<void> {
    let payload;
    try { payload = canonicalPayment(body); }
    catch { throw apiError(400, 'INVALID_REQUEST', 'Invalid payment event.'); }
    let result;
    try {
      result = await this.payments.execute(payload);
    } catch (error) {
      const driver = error instanceof Error && error.cause ? error.cause : error;
      const code = (driver as { code?: string })?.code;
      if (error instanceof PaymentUnavailable || isTransientDatabaseFailure(error) || code === '40001' || code === '40P01') {
        throw apiError(503, 'PAYMENT_TEMPORARILY_UNAVAILABLE', 'Payment processing is temporarily unavailable. Retry the same event.');
      }
      this.logger.error(JSON.stringify(paymentFailureDiagnostic(error)));
      throw apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
    if (result.status !== 204) throw new HttpException(result.body!, result.status);
  }
}
