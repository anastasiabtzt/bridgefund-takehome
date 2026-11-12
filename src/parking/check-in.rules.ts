export interface CheckInPayload {
  vehicleType: 'CAR' | 'MOTOR';
  isResident: boolean;
  normalizedLicensePlate: string;
}

export function canonicalCheckIn(value: unknown): CheckInPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(',') !== 'isResident,licensePlate,vehicleType'
    || !['CAR', 'MOTOR'].includes(body.vehicleType as string) || typeof body.isResident !== 'boolean'
    || typeof body.licensePlate !== 'string' || !/^[A-Za-z0-9 -]{1,32}$/.test(body.licensePlate)) {
    throw new Error('Invalid request.');
  }
  const plate = body.licensePlate.toUpperCase().replace(/[ -]/g, '');
  if (!/^[A-Z0-9]{1,16}$/.test(plate)) throw new Error('Invalid request.');
  return { vehicleType: body.vehicleType as 'CAR' | 'MOTOR', isResident: body.isResident, normalizedLicensePlate: plate };
}

export function canonicalRequestId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid request ID.');
  return value.toLowerCase();
}

export function eligibleRange(payload: CheckInPayload): [number, number] {
  return payload.isResident ? [1, 50] : payload.vehicleType === 'CAR' ? [51, 130] : [131, 150];
}

export function samePayload(first: unknown, second: CheckInPayload): boolean {
  if (!first || typeof first !== 'object') return false;
  const payload = first as CheckInPayload;
  return payload.vehicleType === second.vehicleType && payload.isResident === second.isResident
    && payload.normalizedLicensePlate === second.normalizedLicensePlate;
}
