import { HttpException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

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
