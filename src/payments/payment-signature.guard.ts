import { CanActivate, ExecutionContext, Inject, Injectable, RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { APP_CONFIG, AppConfig } from '../config.js';
import { apiError, rawHeaderValues } from '../http-utils.js';

export function validPaymentSignature(secret: string | undefined, rawBody: unknown, signatures: string[]): boolean {
  if (!secret || !Buffer.isBuffer(rawBody) || signatures.length !== 1 || !/^[0-9a-f]{64}$/.test(signatures[0])) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signatures[0], 'hex'));
}

@Injectable()
export class PaymentSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<IncomingMessage>>();
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      throw apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
    }
    if (!validPaymentSignature(this.config.webhookSecret, request.rawBody, rawHeaderValues(request, 'x-signature'))) {
      throw apiError(401, 'INVALID_SIGNATURE', 'A valid provider signature is required.');
    }
    return true;
  }
}
