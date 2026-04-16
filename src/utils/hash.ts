import * as Crypto from 'expo-crypto';
import { HashFn } from '../types';

export const sha256: HashFn = async (input) => {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
};
