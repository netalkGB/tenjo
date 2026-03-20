import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type RelativeTimeUnit =
  | 'just_now'
  | 'minutes'
  | 'hours'
  | 'yesterday'
  | 'days'
  | 'months'
  | 'years';

export interface RelativeTimeResult {
  unit: RelativeTimeUnit;
  value: number;
}

/**
 * Calculate relative time from a date
 * @param date - The date to calculate (null returns null)
 * @returns Object with unit and value, or null if date is null
 * @example
 * getRelativeTime(date) // { unit: 'hours', value: 3 }
 * getRelativeTime(date) // { unit: 'just_now', value: 0 }
 */
export function getRelativeTime(date: Date | null): RelativeTimeResult | null {
  if (!date) return null;

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes === 0) {
    return { unit: 'just_now', value: 0 };
  }
  if (minutes < 60) {
    return { unit: 'minutes', value: minutes };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) {
    return { unit: 'hours', value: hours };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 1) {
    return { unit: 'yesterday', value: 1 };
  }
  if (days < 30) {
    return { unit: 'days', value: days };
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return { unit: 'months', value: months };
  }

  const years = Math.floor(days / 365);
  return { unit: 'years', value: years };
}
