const hourMs = 60 * 60 * 1000;
const amsterdamDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function localDay(instant: number): string {
  return amsterdamDate.formatToParts(instant)
    .filter((part) => ['year', 'month', 'day'].includes(part.type))
    .map((part) => part.value).join('/');
}

// Find the first millisecond belonging to the next Amsterdam date. Bracket the
// change, then bisect: no parsed locale strings, UTC offsets or 24-hour-day rule.
function nextAmsterdamMidnight(instant: number): number {
  const day = localDay(instant);
  let low = instant;
  let step = hourMs;
  let high = instant + step;
  while (localDay(high) === day) { step *= 2; high = instant + step; }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDay(middle) === day) low = middle;
    else high = middle;
  }
  return high;
}

export function calculateCharge(checkInAt: Date, checkoutAt: Date, vehicleType: 'CAR' | 'MOTOR', isResident: boolean): number {
  let cursor = checkInAt.getTime();
  const end = checkoutAt.getTime();
  if (!Number.isFinite(cursor) || !Number.isFinite(end) || end < cursor) throw new RangeError('Invalid billing interval.');
  if (isResident || cursor === end) return 0;
  const rate = vehicleType === 'CAR' ? 500 : 300;
  const cap = vehicleType === 'CAR' ? 3000 : 1800;
  let cents = 0;
  while (cursor < end) {
    const segmentEnd = Math.min(end, nextAmsterdamMidnight(cursor));
    cents += Math.min(cap, Math.ceil((segmentEnd - cursor) / hourMs) * rate);
    cursor = segmentEnd;
  }
  if (!Number.isSafeInteger(cents)) throw new RangeError('Charge exceeds supported integer range.');
  return cents;
}
