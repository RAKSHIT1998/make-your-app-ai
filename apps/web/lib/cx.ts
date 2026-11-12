import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and resolves Tailwind conflicts so callers can override defaults. Safe on server and client. */
export const cx = (...a: ClassValue[]) => twMerge(clsx(a));
