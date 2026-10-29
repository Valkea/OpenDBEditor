const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function uid(len = 7): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
