import {
  CURRENCY_MINOR_UNITS,
  isSupportedCurrencyCode,
  normalizeCurrencyCode,
} from './currency-minor-units';

describe('currency minor units map', () => {
  it('accepts INR and USD', () => {
    expect(isSupportedCurrencyCode('INR')).toBe(true);
    expect(isSupportedCurrencyCode('usd')).toBe(true);
    expect(CURRENCY_MINOR_UNITS.INR).toBe(2);
    expect(CURRENCY_MINOR_UNITS.USD).toBe(2);
  });

  it('rejects unsupported currencies (JPY, KWD)', () => {
    expect(isSupportedCurrencyCode('JPY')).toBe(false);
    expect(isSupportedCurrencyCode('KWD')).toBe(false);
  });

  it('normalizes code formatting', () => {
    expect(normalizeCurrencyCode(' inr ')).toBe('INR');
  });
});
