import { describe, expect, it } from 'vitest';
import {
  contractAmountsEqual,
  convertContractAmount,
  formatContractMoneyInCurrency,
  formatSalaryChangePercent,
  formatSignedContractMoneyDelta,
} from './contractMoney';

const RATE = 4100;

describe('contractMoney cross-currency', () => {
  it('converts KHR to USD for display', () => {
    expect(formatContractMoneyInCurrency(700, 'KHR', 'USD', RATE)).toBe('$0.17');
  });

  it('converts USD to KHR for display', () => {
    expect(formatContractMoneyInCurrency(100, 'USD', 'KHR', RATE)).toBe('410,000 KHR');
  });

  it('treats equivalent amounts as equal across currencies', () => {
    expect(contractAmountsEqual(700, 'KHR', 0.17, 'USD', RATE)).toBe(true);
    expect(contractAmountsEqual(410_000, 'KHR', 100, 'USD', RATE)).toBe(true);
  });

  it('converts entered amounts when currency changes', () => {
    expect(convertContractAmount(700, 'KHR', 'USD', RATE)).toBe(0.17);
    expect(convertContractAmount(100, 'USD', 'KHR', RATE)).toBe(410_000);
  });

  it('prefixes signed deltas with + or -', () => {
    expect(formatSignedContractMoneyDelta(100, 'USD', RATE)).toBe('+$100.00');
    expect(formatSignedContractMoneyDelta(-100, 'USD', RATE)).toBe('-$100.00');
    expect(formatSignedContractMoneyDelta(100, 'KHR', RATE)).toBe('+410,000 KHR');
    expect(formatSignedContractMoneyDelta(-100, 'KHR', RATE)).toBe('-410,000 KHR');
  });

  it('formats salary change as percent using (new-old)/old in USD', () => {
    expect(
      formatSalaryChangePercent({
        fromAmount: 900,
        fromCurrency: 'USD',
        toAmount: 1000,
        toCurrency: 'USD',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBe('+11.1%');
    expect(
      formatSalaryChangePercent({
        fromAmount: 500,
        fromCurrency: 'USD',
        toAmount: 600,
        toCurrency: 'USD',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBe('+20%');
    expect(
      formatSalaryChangePercent({
        fromAmount: 700,
        fromCurrency: 'USD',
        toAmount: 600,
        toCurrency: 'USD',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBe('-14.3%');
    expect(
      formatSalaryChangePercent({
        fromAmount: 0,
        fromCurrency: 'USD',
        toAmount: 1400,
        toCurrency: 'USD',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBe('New');
    expect(
      formatSalaryChangePercent({
        fromAmount: 700,
        fromCurrency: 'KHR',
        toAmount: 840,
        toCurrency: 'KHR',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBe('+20%');
    expect(
      formatSalaryChangePercent({
        fromAmount: 410_000,
        fromCurrency: 'KHR',
        toAmount: 100,
        toCurrency: 'USD',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBeNull();
    expect(
      formatSalaryChangePercent({
        fromAmount: 700,
        fromCurrency: 'KHR',
        toAmount: 700,
        toCurrency: 'KHR',
        exchangeRateKhrPerUsd: RATE,
      })
    ).toBeNull();
  });
});
