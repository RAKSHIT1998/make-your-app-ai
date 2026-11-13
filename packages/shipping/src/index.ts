export * from './types.js';
export * from './shiprocket.js';
import { ShiprocketProvider } from './shiprocket.js';
import type { ShippingFactory } from './types.js';

export const defaultShippingFactory: ShippingFactory = (creds) => new ShiprocketProvider(creds);
