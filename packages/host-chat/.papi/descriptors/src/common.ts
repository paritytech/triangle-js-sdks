const table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
export const toBinary = (base64: string) => {
  const n = base64.length,
    bytes = new Uint8Array((n - Number(base64[n - 1] === '=') - Number(base64[n - 2] === '=')) * 3 / 4 | 0);
  for (let i2 = 0, j = 0; i2 < n;) {
    const c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
    const c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
    bytes[j++] = c0 << 2 | c1 >> 4;
    bytes[j++] = c1 << 4 | c2 >> 2;
    bytes[j++] = c2 << 6 | c3;
  }
  return bytes;
}