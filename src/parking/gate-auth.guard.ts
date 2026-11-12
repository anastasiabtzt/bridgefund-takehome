import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { APP_CONFIG, AppConfig, GateCredential } from '../config.js';

export const REQUIRED_GATE_ROLE = 'parking:gate-role';

export interface GateRequest extends IncomingMessage { gate: GateCredential }
export function apiError(status: number, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}
export function rawHeaderValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() === name) values.push(request.rawHeaders[i + 1]);
  }
  return values;
}

@Injectable()
export class GateAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GateRequest>();
    const headers = rawHeaderValues(request, 'authorization');
    const token = headers.length === 1 ? /^Bearer ([!-~]+)$/.exec(headers[0])?.[1] : undefined;
    const hash = createHash('sha256').update(token ?? '').digest();
    const gate = this.config.gates.find((candidate) => timingSafeEqual(hash, createHash('sha256').update(candidate.secret).digest()));
    if (!token || !gate) throw apiError(401, 'UNAUTHENTICATED', 'Valid gate credentials are required.');
    const role = this.reflector.getAllAndOverride<'ENTRANCE' | 'EXIT'>(REQUIRED_GATE_ROLE, [context.getHandler(), context.getClass()]) ?? 'ENTRANCE';
    if (gate.role !== role) throw apiError(403, 'GATE_NOT_AUTHORIZED', 'Required gate permission is missing.');
    request.gate = gate;
    return true;
  }
}
