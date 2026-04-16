// __tests__/testHash.ts
import { createHash } from 'crypto';
import { HashFn } from '../src/types';

export const testSha256: HashFn = async (input) => {
  return createHash('sha256').update(input).digest('hex');
};
