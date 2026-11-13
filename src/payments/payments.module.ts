import { DynamicModule, Module } from '@nestjs/common';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { PaymentSignatureGuard } from './payment-signature.guard.js';

@Module({})
export class PaymentsModule {
  static register(runtime: DynamicModule, parking: DynamicModule): DynamicModule {
    return { module: PaymentsModule, imports: [runtime, parking], controllers: [PaymentController],
      providers: [PaymentService, PaymentSignatureGuard] };
  }
}
