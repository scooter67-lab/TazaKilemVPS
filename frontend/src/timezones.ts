/**
 * Короткий список только смещений от UTC (целые часы −12…+14).
 * Внутри хранится фиксированная IANA-зона без DST: UTC или Etc/GMT±N
 * (знак в Etc/GMT обратный знаку смещения от UTC).
 */
const MIN_OFFSET_H = -12;
const MAX_OFFSET_H = 14;

function hoursToFixedIana(offsetHours: number): string {
  if (offsetHours === 0) return "UTC";
  const inverted = -offsetHours;
  if (inverted > 0) return `Etc/GMT+${inverted}`;
  return `Etc/GMT${inverted}`;
}

export function getUtcOffsetZoneChoices(): { label: string; iana: string }[] {
  const out: { label: string; iana: string }[] = [];
  for (let h = MIN_OFFSET_H; h <= MAX_OFFSET_H; h++) {
    const label = h === 0 ? "UTC+0" : h > 0 ? `UTC+${h}` : `UTC${h}`;
    out.push({ label, iana: hoursToFixedIana(h) });
  }
  return out;
}
