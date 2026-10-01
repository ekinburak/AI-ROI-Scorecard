export function formatMoney(
  minor: string,
  currency: string,
  scale: number,
  locale: string,
): string {
  const divisor = 10n ** BigInt(scale);
  const absolute = BigInt(minor) < 0n ? -BigInt(minor) : BigInt(minor);
  const numeric = Number(absolute / divisor) + Number(absolute % divisor) / Number(divisor);
  const signed = BigInt(minor) < 0n ? -numeric : numeric;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(signed);
}

export function formatDuration(milliseconds: string, locale: string): string {
  const value = BigInt(milliseconds);
  const sign = value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  const totalMinutes = Number(absolute) / 60_000;
  if (totalMinutes < 1) {
    return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      totalMinutes * 60,
    )} sec`;
  }
  if (totalMinutes < 60) {
    return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      totalMinutes,
    )} min`;
  }
  return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    totalMinutes / 60,
  )} hr`;
}
