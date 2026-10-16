/** Sync SHA-256 (lowercase hex). Safe to call twice; IVs are copied per digest. */
export function sha256Hex(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const maxWord = 2 ** 32;
  const k = sha256Hex.k || (sha256Hex.k = []);
  let iv = sha256Hex.iv;
  if (k.length < 64) {
    const isComposite = {};
    const roots = [];
    let primeCounter = 0;
    for (let candidate = 2; primeCounter < 64; candidate += 1) {
      if (!isComposite[candidate]) {
        for (let n = 0; n < 313; n += candidate) isComposite[n] = candidate;
        roots[primeCounter] = (candidate ** 0.5 * maxWord) | 0;
        k[primeCounter] = (candidate ** (1 / 3) * maxWord) | 0;
        primeCounter += 1;
      }
    }
    iv = sha256Hex.iv = roots.slice(0, 8);
  }
  const hash = iv.slice();
  let result = '';
  const words = [];
  const asciiBitLength = ascii.length * 8;
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i += 1) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = asciiBitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0, 8);
    const nextHash = hash.slice(0, 8);
    for (let i = 0; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = nextHash[0];
      const e = nextHash[4];
      const temp1 = nextHash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & nextHash[5]) ^ ((~e) & nextHash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & nextHash[1]) ^ (a & nextHash[2]) ^ (nextHash[1] & nextHash[2]));
      nextHash.unshift((temp1 + temp2) | 0);
      nextHash[4] = (nextHash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i += 1) hash[i] = (nextHash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i += 1) {
    for (let j = 3; j + 1; j -= 1) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}
