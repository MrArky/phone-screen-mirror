'use strict';

/**
 * FairPlay "playfair" stream-key decryption, ported from RPiPlay's
 * lib/playfair (GPLv3): omg_hax.c, hand_garble.c, modified_md5.c, sap_hash.c,
 * playfair.c. This recovers the 16-byte AES stream key from the 72-byte `ekey`
 * and the 164-byte fp-setup phase-2 message.
 *
 * Porting notes (C -> JS):
 *  - unsigned char buffers -> Uint8Array (stores auto-mask to 8 bits).
 *  - (uint32_t*)block casts assume little-endian (RPi/x86); see rd32/wr32.
 *  - multiplications use Math.imul (low-32 wrap = C unsigned int); divisions use
 *    Math.trunc (C integer division); helper calls mask args to 8 bits to match
 *    C's implicit uint8_t parameter conversion.
 *  - MD5 constants are the canonical floor(2^32*|sin(i+1)|) table.
 */

const T = require('./playfair-tables');

// --- little-endian 32-bit helpers on byte arrays --------------------------
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function wr32(b, o, v) {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}
const u32 = (x) => x >>> 0;
const mul = (a, b) => Math.imul(a, b) >>> 0;
const idiv = (a, b) => Math.trunc(a / b);

// --- small rotations (match sap_hash.c / hand_garble.c exactly) -----------
function rol8(input, count) {
  input &= 0xff;
  return (((input << count) & 0xff) | (input >> (8 - count))) & 0xff;
}
function rol8x(input, count) {
  input &= 0xff;
  return ((input << count) | (input >> (8 - count))) >>> 0;
}
function weird_ror8(input, count) {
  input &= 0xff;
  if (count === 0) return 0;
  return (((input >> count) & 0xff) | ((input << (8 - count)) & 0xff)) >>> 0;
}
function weird_rol8(input, count) {
  input &= 0xff;
  if (count === 0) return 0;
  return (((input << count) & 0xff) | (input >> (8 - count))) >>> 0;
}
function weird_rol32(input, count) {
  input &= 0xff;
  if (count === 0) return 0;
  return ((input << count) ^ (input >> (8 - count))) >>> 0;
}

// --- XOR helpers (omg_hax.c) ----------------------------------------------
function xorBlocks(a, ao, b, bo, out, oo) {
  for (let i = 0; i < 16; i++) out[oo + i] = a[ao + i] ^ b[bo + i];
}
function z_xor(inb, io, outb, oo, blocks) {
  for (let j = 0; j < blocks; j++) for (let i = 0; i < 16; i++) outb[oo + j * 16 + i] = inb[io + j * 16 + i] ^ T.z_key[i];
}
function x_xor(inb, io, outb, oo, blocks) {
  for (let j = 0; j < blocks; j++) for (let i = 0; i < 16; i++) outb[oo + j * 16 + i] = inb[io + j * 16 + i] ^ T.x_key[i];
}
function t_xor(inb, io, outb, oo) {
  for (let i = 0; i < 16; i++) outb[oo + i] = inb[io + i] ^ T.t_key[i];
}

// --- table index helpers --------------------------------------------------
const tableIndexBase = (i) => ((31 * i) % 0x28) << 8; // into table_s1
const messageTableBase = (i) => ((97 * i) % 144) << 8; // into table_s2
const permuteTable2Base = (i) => ((71 * i) % 144) << 8; // into table_s4

// --- permutations (omg_hax.c) ---------------------------------------------
function permute_block_1(block) {
  const s3 = T.table_s3;
  block[0] = s3[block[0]];
  block[4] = s3[0x400 + block[4]];
  block[8] = s3[0x800 + block[8]];
  block[12] = s3[0xc00 + block[12]];
  let tmp = block[13];
  block[13] = s3[0x100 + block[9]];
  block[9] = s3[0xd00 + block[5]];
  block[5] = s3[0x900 + block[1]];
  block[1] = s3[0x500 + tmp];
  tmp = block[2];
  block[2] = s3[0xa00 + block[10]];
  block[10] = s3[0x200 + tmp];
  tmp = block[6];
  block[6] = s3[0xe00 + block[14]];
  block[14] = s3[0x600 + tmp];
  tmp = block[3];
  block[3] = s3[0xf00 + block[7]];
  block[7] = s3[0x300 + block[11]];
  block[11] = s3[0x700 + block[15]];
  block[15] = s3[0xb00 + tmp];
}

function permute_block_2(block, round) {
  const s4 = T.table_s4;
  const P = (i) => permuteTable2Base(round * 16 + i);
  block[0] = s4[P(0) + block[0]];
  block[4] = s4[P(4) + block[4]];
  block[8] = s4[P(8) + block[8]];
  block[12] = s4[P(12) + block[12]];
  let tmp = block[13];
  block[13] = s4[P(13) + block[9]];
  block[9] = s4[P(9) + block[5]];
  block[5] = s4[P(5) + block[1]];
  block[1] = s4[P(1) + tmp];
  tmp = block[2];
  block[2] = s4[P(2) + block[10]];
  block[10] = s4[P(10) + tmp];
  tmp = block[6];
  block[6] = s4[P(6) + block[14]];
  block[14] = s4[P(14) + tmp];
  tmp = block[3];
  block[3] = s4[P(3) + block[7]];
  block[7] = s4[P(7) + block[11]];
  block[11] = s4[P(11) + block[15]];
  block[15] = s4[P(15) + tmp];
}

// --- key schedule (omg_hax.c generate_key_schedule) -----------------------
// key_schedule is Array(11) of [w0,w1,w2,w3] uint32. `kd` is the 16-byte buffer
// that aliases key_data (words) and buffer (bytes) in the C.
function generate_key_schedule(keyMaterial16) {
  const ks = Array.from({ length: 11 }, () => [0, 0, 0, 0]);
  const kd = new Uint8Array(16);
  t_xor(keyMaterial16, 0, kd, 0); // G
  let ti = 0;
  for (let round = 0; round < 11; round++) {
    ks[round][0] = rd32(kd, 0); // H
    const t1 = tableIndexBase(ti);
    const t2 = tableIndexBase(ti + 1);
    const t3 = tableIndexBase(ti + 2);
    const t4 = tableIndexBase(ti + 3);
    ti += 4;
    const s1 = T.table_s1;
    kd[0] ^= s1[t1 + kd[0x0d]] ^ T.index_mangle[round]; // I
    kd[1] ^= s1[t2 + kd[0x0e]];
    kd[2] ^= s1[t3 + kd[0x0f]];
    kd[3] ^= s1[t4 + kd[0x0c]];
    ks[round][1] = rd32(kd, 4); // H
    wr32(kd, 4, u32(rd32(kd, 4) ^ rd32(kd, 0))); // J: key_data[1] ^= key_data[0]
    ks[round][2] = rd32(kd, 8); // H
    wr32(kd, 8, u32(rd32(kd, 8) ^ rd32(kd, 4))); // J: key_data[2] ^= key_data[1]
    ks[round][3] = rd32(kd, 12);
    wr32(kd, 12, u32(rd32(kd, 12) ^ rd32(kd, 8))); // J: key_data[3] ^= key_data[2]
  }
  return ks;
}

// --- cycle (omg_hax.c) — the table-driven AES-like block transform --------
function cycle(block, ks) {
  wr32(block, 0, u32(rd32(block, 0) ^ ks[10][0]));
  wr32(block, 4, u32(rd32(block, 4) ^ ks[10][1]));
  wr32(block, 8, u32(rd32(block, 8) ^ ks[10][2]));
  wr32(block, 12, u32(rd32(block, 12) ^ ks[10][3]));
  permute_block_1(block);

  const { table_s5: s5, table_s6: s6, table_s7: s7, table_s8: s8 } = T;
  for (let round = 0; round < 9; round++) {
    const k = ks[9 - round];
    const key0 = [k[0] & 0xff, (k[0] >>> 8) & 0xff, (k[0] >>> 16) & 0xff, (k[0] >>> 24) & 0xff];
    const key1 = [k[1] & 0xff, (k[1] >>> 8) & 0xff, (k[1] >>> 16) & 0xff, (k[1] >>> 24) & 0xff];
    const key2 = [k[2] & 0xff, (k[2] >>> 8) & 0xff, (k[2] >>> 16) & 0xff, (k[2] >>> 24) & 0xff];
    const key3 = [k[3] & 0xff, (k[3] >>> 8) & 0xff, (k[3] >>> 16) & 0xff, (k[3] >>> 24) & 0xff];

    let ab = u32(s5[block[3] ^ key0[3]] ^ s6[block[2] ^ key0[2]] ^ s8[block[0] ^ key0[0]] ^ s7[block[1] ^ key0[1]]);
    wr32(block, 0, ab);
    ab = u32(s6[block[6] ^ key1[2]] ^ s5[block[7] ^ key1[3]] ^ s8[block[4] ^ key1[0]] ^ s7[block[5] ^ key1[1]]);
    wr32(block, 4, ab);
    wr32(block, 8, u32(s5[block[11] ^ key2[3]] ^ s6[block[10] ^ key2[2]] ^ s7[block[9] ^ key2[1]] ^ s8[block[8] ^ key2[0]]));
    wr32(block, 12, u32(s5[block[15] ^ key3[3]] ^ s6[block[14] ^ key3[2]] ^ s7[block[13] ^ key3[1]] ^ s8[block[12] ^ key3[0]]));
    permute_block_2(block, 8 - round);
  }
  wr32(block, 0, u32(rd32(block, 0) ^ ks[0][0]));
  wr32(block, 4, u32(rd32(block, 4) ^ ks[0][1]));
  wr32(block, 8, u32(rd32(block, 8) ^ ks[0][2]));
  wr32(block, 12, u32(rd32(block, 12) ^ ks[0][3]));
}

// --- decryptMessage (omg_hax.c) -------------------------------------------
function decryptMessage(messageIn) {
  const decrypted = new Uint8Array(128);
  const buffer = new Uint8Array(16);
  const mode = messageIn[12];
  const s2 = T.table_s2;
  const s9 = T.table_s9;
  const s10 = T.table_s10;
  const mkeyBase = mode * 144; // message_key[mode][...] flattened
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 16; j++) {
      if (mode === 3) buffer[j] = messageIn[0x80 - 0x10 * i + j];
      else buffer[j] = messageIn[0x10 * (i + 1) + j];
    }
    for (let j = 0; j < 9; j++) {
      const base = 0x80 - 0x10 * j;
      const MT = (o) => messageTableBase(base + o);
      const MK = (o) => T.message_key[mkeyBase + base + o];
      buffer[0x0] = s2[MT(0x0) + buffer[0x0]] ^ MK(0x0);
      buffer[0x4] = s2[MT(0x4) + buffer[0x4]] ^ MK(0x4);
      buffer[0x8] = s2[MT(0x8) + buffer[0x8]] ^ MK(0x8);
      buffer[0xc] = s2[MT(0xc) + buffer[0xc]] ^ MK(0xc);
      let tmp = buffer[0x0d];
      buffer[0xd] = s2[MT(0xd) + buffer[0x9]] ^ MK(0xd);
      buffer[0x9] = s2[MT(0x9) + buffer[0x5]] ^ MK(0x9);
      buffer[0x5] = s2[MT(0x5) + buffer[0x1]] ^ MK(0x5);
      buffer[0x1] = s2[MT(0x1) + tmp] ^ MK(0x1);
      tmp = buffer[0x02];
      buffer[0x2] = s2[MT(0x2) + buffer[0xa]] ^ MK(0x2);
      buffer[0xa] = s2[MT(0xa) + tmp] ^ MK(0xa);
      tmp = buffer[0x06];
      buffer[0x6] = s2[MT(0x6) + buffer[0xe]] ^ MK(0x6);
      buffer[0xe] = s2[MT(0xe) + tmp] ^ MK(0xe);
      tmp = buffer[0x3];
      buffer[0x3] = s2[MT(0x3) + buffer[0x7]] ^ MK(0x3);
      buffer[0x7] = s2[MT(0x7) + buffer[0xb]] ^ MK(0x7);
      buffer[0xb] = s2[MT(0xb) + buffer[0xf]] ^ MK(0xb);
      buffer[0xf] = s2[MT(0xf) + tmp] ^ MK(0xf);
      wr32(buffer, 0, u32(s9[0x000 + buffer[0x0]] ^ s9[0x100 + buffer[0x1]] ^ s9[0x200 + buffer[0x2]] ^ s9[0x300 + buffer[0x3]]));
      wr32(buffer, 4, u32(s9[0x000 + buffer[0x4]] ^ s9[0x100 + buffer[0x5]] ^ s9[0x200 + buffer[0x6]] ^ s9[0x300 + buffer[0x7]]));
      wr32(buffer, 8, u32(s9[0x000 + buffer[0x8]] ^ s9[0x100 + buffer[0x9]] ^ s9[0x200 + buffer[0xa]] ^ s9[0x300 + buffer[0xb]]));
      wr32(buffer, 12, u32(s9[0x000 + buffer[0xc]] ^ s9[0x100 + buffer[0xd]] ^ s9[0x200 + buffer[0xe]] ^ s9[0x300 + buffer[0xf]]));
    }
    buffer[0x0] = s10[(0x0 << 8) + buffer[0x0]];
    buffer[0x4] = s10[(0x4 << 8) + buffer[0x4]];
    buffer[0x8] = s10[(0x8 << 8) + buffer[0x8]];
    buffer[0xc] = s10[(0xc << 8) + buffer[0xc]];
    let tmp = buffer[0x0d];
    buffer[0xd] = s10[(0xd << 8) + buffer[0x9]];
    buffer[0x9] = s10[(0x9 << 8) + buffer[0x5]];
    buffer[0x5] = s10[(0x5 << 8) + buffer[0x1]];
    buffer[0x1] = s10[(0x1 << 8) + tmp];
    tmp = buffer[0x02];
    buffer[0x2] = s10[(0x2 << 8) + buffer[0xa]];
    buffer[0xa] = s10[(0xa << 8) + tmp];
    tmp = buffer[0x06];
    buffer[0x6] = s10[(0x6 << 8) + buffer[0xe]];
    buffer[0xe] = s10[(0xe << 8) + tmp];
    tmp = buffer[0x3];
    buffer[0x3] = s10[(0x3 << 8) + buffer[0x7]];
    buffer[0x7] = s10[(0x7 << 8) + buffer[0xb]];
    buffer[0xb] = s10[(0xb << 8) + buffer[0xf]];
    buffer[0xf] = s10[(0xf << 8) + tmp];

    if (mode === 2 || mode === 1 || mode === 0) {
      if (i > 0) xorBlocks(buffer, 0, messageIn, 0x10 * i, decrypted, 0x10 * i);
      else xorBlocks(buffer, 0, T.message_iv, mode * 16, decrypted, 0);
    } else {
      if (i < 7) xorBlocks(buffer, 0, messageIn, 0x70 - 0x10 * i, decrypted, 0x70 - 0x10 * i);
      else xorBlocks(buffer, 0, T.message_iv, mode * 16, decrypted, 0x70 - 0x10 * i);
    }
  }
  return decrypted;
}

// --- modified_md5 (modified_md5.c) ----------------------------------------
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const rol = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;

function modified_md5(originalBlockIn, oi, keyIn) {
  const block = new Uint8Array(64);
  block.set(originalBlockIn.subarray(oi, oi + 64));
  let A = rd32(keyIn, 0);
  let B = rd32(keyIn, 4);
  let C = rd32(keyIn, 8);
  let D = rd32(keyIn, 12);
  for (let i = 0; i < 64; i++) {
    let j;
    if (i < 16) j = i;
    else if (i < 32) j = (5 * i + 1) % 16;
    else if (i < 48) j = (3 * i + 5) % 16;
    else j = (7 * i) % 16;
    const input = ((block[4 * j] << 24) | (block[4 * j + 1] << 16) | (block[4 * j + 2] << 8) | block[4 * j + 3]) >>> 0;
    let Z = u32(A + input + MD5_K[i]);
    let f;
    if (i < 16) f = ((B & C) | (~B & D)) >>> 0;
    else if (i < 32) f = ((B & D) | (C & ~D)) >>> 0;
    else if (i < 48) f = (B ^ C ^ D) >>> 0;
    else f = (C ^ (B | ~D)) >>> 0;
    Z = rol(u32(Z + f), MD5_SHIFT[i]);
    Z = u32(Z + B);
    const tmp = D;
    D = C;
    C = B;
    B = Z;
    A = tmp;
    if (i === 31) {
      swapWord(block, A & 15, B & 15);
      swapWord(block, C & 15, D & 15);
      swapWord(block, (A & (15 << 4)) >>> 4, (B & (15 << 4)) >>> 4);
      swapWord(block, (A & (15 << 8)) >>> 8, (B & (15 << 8)) >>> 8);
      swapWord(block, (A & (15 << 12)) >>> 12, (B & (15 << 12)) >>> 12);
    }
  }
  const out = new Uint8Array(16);
  wr32(out, 0, u32(rd32(keyIn, 0) + A));
  wr32(out, 4, u32(rd32(keyIn, 4) + B));
  wr32(out, 8, u32(rd32(keyIn, 8) + C));
  wr32(out, 12, u32(rd32(keyIn, 12) + D));
  return out;
}
function swapWord(block, i, j) {
  for (let k = 0; k < 4; k++) {
    const t = block[i * 4 + k];
    block[i * 4 + k] = block[j * 4 + k];
    block[j * 4 + k] = t;
  }
}

// --- garble (hand_garble.c) — the obfuscated buffer mangler ----------------
// buffer0[20], buffer1[210], buffer2[35], buffer3[132], buffer4[21]. Ported
// statement-for-statement; b0..b4 are Uint8Array so all stores mask to 8 bits.
function garble(b0, b1, b2, b3, b4) {
  let A, B, C, D, E, M, J, G, F, H, K, R, S, TT, U, V, W, X, Y, Z, tmp, tmp2, tmp3;
  b2[12] = 0x14 + (((b1[64] & 92) | (idiv(b1[99], 3) & 35)) & b4[rol8x(b4[b1[206] % 21], 4) % 21]);
  b1[4] = mul(mul(idiv(b1[99], 5), idiv(b1[99], 5)), 2);
  b2[34] = 0xb8;
  b1[153] ^= mul(mul(b2[b1[203] % 35], b2[b1[203] % 35]), b1[190]);
  b0[3] -= ((b4[b1[205] % 21] >> 1) & 80) | 0xe6440;
  b0[16] = 0x93;
  b0[13] = 0x62;
  b1[33] -= b4[b1[36] % 21] & 0xf6;
  tmp2 = b2[b1[67] % 35];
  b2[12] = 0x07;
  tmp = b0[b1[181] % 20];
  b1[2] -= 3136;
  b0[19] = b4[b1[58] % 21];
  b3[0] = 92 - b2[b1[32] % 35];
  b3[4] = b2[b1[15] % 35] + 0x9e;
  b1[34] += idiv(b4[((b2[b1[15] % 35] + 0x9e) & 0xff) % 21], 5);
  b0[19] += u32(0xfffffee6 - ((b0[b3[4] % 20] >> 1) & 102));
  b1[15] = mul(3, ((b1[72] >> (b4[b1[190] % 21] & 7)) ^ (b1[72] << ((7 - (b4[b1[190] % 21] - 1)) & 7))) - mul(3, b4[b1[126] % 21])) ^ b1[15];
  b0[15] ^= mul(mul(b2[b1[181] % 35], b2[b1[181] % 35]), b2[b1[181] % 35]);
  b2[4] ^= idiv(b1[202], 3);
  A = 92 - b0[b3[0] % 20];
  E = (A & 0xc6) | (~b1[105] & 0xc6) | (A & ~b1[105]);
  b2[1] += mul(mul(E, E), E);
  b0[19] ^= idiv(mul((224 | (b4[b1[92] % 21] & 27)), b2[b1[41] % 35]), 3);
  b1[140] += weird_ror8(92, b1[5] & 7);
  b2[12] += ((((~b1[4]) ^ b2[b1[12] % 35]) | b1[182]) & 192) | (((~b1[4]) ^ b2[b1[12] % 35]) & b1[182]);
  b1[36] += 125;
  b1[124] = rol8x(((((74 & b1[138]) | ((74 | b1[138]) & b0[15])) & b0[b1[43] % 20]) | (((74 & b1[138]) | ((74 | b1[138]) & b0[15]) | b0[b1[43] % 20]) & 95)), 4);
  b3[8] = (((b0[b3[4] % 20] & 95) & ((b4[b1[68] % 21] & 46) << 1)) | 16) ^ 92;
  A = b1[177] + b4[b1[79] % 21];
  D = (((A >> 1) | idiv(mul(3, b1[148]), 5)) & b2[1]) | ((A >> 1) & idiv(mul(3, b1[148]), 5));
  b3[12] = -34 - D;
  A = 8 - (b2[22] & 7);
  B = b1[33] >> (A & 7);
  C = b1[33] << (b2[22] & 7);
  b2[16] += ((b2[b3[0] % 35] & 159) | b0[b3[4] % 20] | 8) - ((B ^ C) | 128);
  b0[14] ^= b2[b3[12] % 35];
  A = weird_rol8(b4[b0[b1[201] % 20] % 21], (b2[b1[112] % 35] << 1) & 7);
  D = (b0[b1[208] % 20] & 131) | (b0[b1[164] % 20] & 124);
  b1[19] += (A & idiv(D, 5)) | ((A | idiv(D, 5)) & 37);
  b2[8] = weird_ror8(140, mul(b4[b1[45] % 21] + 92, b4[b1[45] % 21] + 92) & 7);
  b1[190] = 56;
  b2[8] ^= b3[0];
  b1[53] = ~idiv(b0[b1[83] % 20] | 204, 5);
  b0[13] += b0[b1[41] % 20];
  b0[10] = idiv((b2[b3[0] % 35] & b1[2]) | ((b2[b3[0] % 35] | b1[2]) & b3[12]), 15);
  A = (((56 | (b4[b1[2] % 21] & 68)) | b2[b3[8] % 35]) & 42) | (((b4[b1[2] % 21] & 68) | 56) & b2[b3[8] % 35]);
  b3[16] = mul(A, A) + 110;
  b3[20] = 202 - b3[16];
  b3[24] = b1[151];
  b2[13] ^= b4[b3[0] % 21];
  B = ((b2[b1[179] % 35] - 38) & 177) | (b3[12] & 177);
  C = (b2[b1[179] % 35] - 38) & b3[12];
  b3[28] = 30 + mul(B | C, B | C);
  b3[32] = b3[28] + 62;
  A = ((b3[20] + (b3[0] & 74)) | ~b4[b3[0] % 21]) & 121;
  B = (b3[20] + (b3[0] & 74)) & ~b4[b3[0] % 21];
  tmp3 = (A | B) >>> 0;
  C = (((u32((A | B) ^ 0xffffffa6) | b3[0]) & 4) | (u32((A | B) ^ 0xffffffa6) & b3[0]));
  b1[47] = (b2[b1[89] % 35] + C) ^ b1[47];
  b3[36] = ((rol8((tmp & 179) + 68, 2) & b0[3]) | (tmp2 & ~b0[3])) - 15;
  b1[123] ^= 221;
  A = idiv(b4[b3[0] % 21], 3) - b2[b3[4] % 35];
  C = (((b3[0] & 163) + 92) & 246) | (b3[0] & 92);
  E = ((C | b3[24]) & 54) | (C & b3[24]);
  b3[40] = A - E;
  b3[44] = tmp3 ^ 81 ^ (((b3[0] >> 1) & 101) + 26);
  b3[48] = b2[b3[4] % 35] & 27;
  b3[52] = 27;
  b3[56] = 199;
  b3[64] = b3[4] + (((((((b3[40] | b3[24]) & 177) | (b3[40] & b3[24])) & ((((b4[b3[0] % 20] & 177) | 176)) | (b4[b3[0] % 21] & ~3))) | ((((b3[40] & b3[24]) | ((b3[40] | b3[24]) & 177)) & 199) | ((((b4[b3[0] % 21] & 1) + 176) | (b4[b3[0] % 21] & ~3)) & b3[56]))) & (~b3[52])) | b3[48]);
  b2[33] ^= b1[26];
  b1[106] ^= b3[20] ^ 133;
  b2[30] = (idiv(b3[64], 3) - (275 | (b3[0] & 247))) ^ b0[b1[122] % 20];
  b1[22] = (b2[b1[90] % 35] & 95) | 68;
  A = (b4[b3[36] % 21] & 184) | (b2[b3[44] % 35] & ~184);
  b2[18] += mul(mul(A, A), A) >> 1;
  b2[5] -= b4[b1[92] % 21];
  A = (((b1[41] & ~24) | (b2[b1[183] % 35] & 24)) & (b3[16] + 53)) | (b3[20] & b2[b3[20] % 35]);
  B = (b1[17] & ~b3[44]) | (b0[b1[59] % 20] & b3[44]);
  b2[18] ^= mul(A, B);
  A = weird_ror8(b1[11], b2[b1[28] % 35] & 7) & 7;
  B = (((b0[b1[93] % 20] & ~b0[14]) | (b0[14] & 150)) & ~28) | (b1[7] & 28);
  b2[22] = (((((B | weird_rol8(b2[b3[0] % 35], A)) & b2[33]) | (B & weird_rol8(b2[b3[0] % 35], A))) + 74) & 0xff);
  A = b4[(b0[b1[39] % 20] ^ 217) % 21];
  b0[15] -= ((((b3[20] | b3[0]) & 214) | (b3[20] & b3[0])) & A) | ((((b3[20] | b3[0]) & 214) | (b3[20] & b3[0]) | A) & b3[32]);
  B = (((b2[b1[57] % 35] & b0[b3[64] % 20]) | ((b0[b3[64] % 20] | b2[b1[57] % 35]) & 95) | (b3[64] & 45) | 82) & 32);
  C = ((b2[b1[57] % 35] & b0[b3[64] % 20]) | ((b2[b1[57] % 35] | b0[b3[64] % 20]) & 95)) & ((b3[64] & 45) | 82);
  D = ((idiv(b3[0], 3) - (b3[64] | b1[22])) ^ (b3[28] + 62) ^ (B | C));
  TT = b0[(D & 0xff) % 20];
  b3[68] = mul(mul(mul(b0[b1[99] % 20], b0[b1[99] % 20]), b0[b1[99] % 20]), b0[b1[99] % 20]) | b2[b3[64] % 35];
  U = b0[b1[50] % 20];
  W = b2[b1[138] % 35];
  X = b4[b1[39] % 21];
  Y = b0[b1[4] % 20];
  Z = b4[b1[202] % 21];
  V = b0[b1[151] % 20];
  S = b2[b1[14] % 35];
  R = b0[b1[145] % 20];
  A = (b2[b3[68] % 35] & b0[b1[209] % 20]) | ((b2[b3[68] % 35] | b0[b1[209] % 20]) & 24);
  B = weird_rol8(b4[b1[127] % 21], b2[b3[68] % 35] & 7);
  C = (A & b0[10]) | (B & ~b0[10]);
  D = 7 ^ (b4[b2[b3[36] % 35] % 21] << 1);
  b3[72] = (C & 71) | (D & ~71);
  b2[2] += (((b0[b3[20] % 20] << 1) & 159) | (b4[b1[190] % 21] & ~159)) & ((((b4[b3[64] % 21] & 110) | (b0[b1[25] % 20] & ~110)) & ~150) | (b1[25] & 150));
  b2[14] -= ((b2[b3[20] % 35] & (b3[72] ^ b2[b1[100] % 35])) & ~34) | (b1[97] & 34);
  b0[17] = 115;
  b1[23] ^= (((((b4[b1[17] % 21] | b0[b3[20] % 20]) & b3[72]) | (b4[b1[17] % 21] & b0[b3[20] % 20])) & idiv(b1[50], 3)) | ((((b4[b1[17] % 21] | b0[b3[20] % 20]) & b3[72]) | (b4[b1[17] % 21] & b0[b3[20] % 20]) | idiv(b1[50], 3)) & 246)) << 1;
  b0[13] = ((((((b0[b3[40] % 20] | b1[10]) & 82) | (b0[b3[40] % 20] & b1[10])) & 209) | ((b0[b1[39] % 20] << 1) & 46)) >> 1);
  b2[33] -= b1[113] & 9;
  b2[28] -= (((2 | (b1[110] & 222)) >> 1) & ~223) | (b3[20] & 223);
  J = weird_rol8(V | Z, U & 7);
  A = (b2[16] & TT) | (W & ~b2[16]);
  B = (b1[33] & 17) | (X & ~17);
  E = (Y | idiv(A + B, 5)) & 147 | (Y & idiv(A + B, 5));
  M = (b3[40] & b4[((b3[8] + J + E) & 0xff) % 21]) | ((b3[40] | b4[((b3[8] + J + E) & 0xff) % 21]) & b2[23]);
  b0[15] = ((((b4[b3[20] % 21] - 48) & ~b1[184]) | ((b4[b3[20] % 21] - 48) & 189) | (189 & ~b1[184])) & mul(mul(M, M), M));
  b2[22] += b1[183];
  b3[76] = mul(3, b4[b1[1] % 21]) ^ b3[0];
  A = b2[((b3[8] + (J + E)) & 0xff) % 35];
  F = mul(mul(((b4[b1[178] % 21] & A) | ((b4[b1[178] % 21] | A) & 209)), b0[b1[13] % 20]), b4[b1[26] % 21] >> 1);
  G = mul(u32(F + 0x733ffff9), 198) - (mul(u32(F + 0x733ffff9), 396) + 212 & 212) + 85;
  b3[80] = b3[36] + (G ^ 148) + ((G ^ 107) << 1) - 127;
  b3[84] = (b2[b3[64] % 35] & 245) | (b2[b3[20] % 35] & 10);
  A = b0[b3[68] % 20] | 81;
  b2[18] -= (mul(mul(A, A), A) & ~b0[15]) | (idiv(b3[80], 15) & b0[15]);
  b3[88] = b3[8] + J + E - b0[b1[160] % 20] + idiv(b4[b0[((b3[8] + J + E) & 255) % 20] % 21], 3);
  B = ((R ^ b3[72]) & ~198) | (mul(S, S) & 198);
  F = (b4[b1[69] % 21] & b1[172]) | ((b4[b1[69] % 21] | b1[172]) & ((b3[12] - B) + 77));
  b0[16] = 147 - ((b3[72] & ((F & 251) | 1)) | (((F & 250) | b3[72]) & 198));
  C = (b4[b1[168] % 21] & b0[b1[29] % 20] & 7) | ((b4[b1[168] % 21] | b0[b1[29] % 20]) & 6);
  F = (b4[b1[155] % 21] & b1[105]) | ((b4[b1[155] % 21] | b1[105]) & 141);
  b0[3] -= b4[weird_rol32(F, C) % 21];
  b1[5] = weird_ror8(b0[12], idiv(b0[b1[61] % 20], 5) & 7) ^ idiv(u32(~b2[b3[84] % 35]), 5);
  b1[198] += b1[3];
  A = 162 | b2[b3[64] % 35];
  b1[164] += idiv(mul(A, A), 5);
  G = weird_ror8(139, b3[80] & 7);
  C = (mul(mul(b4[b3[64] % 21], b4[b3[64] % 21]), b4[b3[64] % 21]) & 95) | (b0[b3[40] % 20] & ~95);
  b3[92] = (G & 12) | (b0[b3[20] % 20] & 12) | (G & b0[b3[20] % 20]) | C;
  b2[12] += idiv((b1[103] & 32) | (b3[92] & (b1[103] | 60)) | 16, 3);
  b3[96] = b1[143];
  b3[100] = 27;
  b3[104] = (((b3[40] & ~b2[8]) | (b1[35] & b2[8])) & b3[64]) ^ 119;
  b3[108] = 238 & ((((b3[40] & ~b2[8]) | (b1[35] & b2[8])) & b3[64]) << 1);
  b3[112] = (~b3[64] & idiv(b3[84], 3)) ^ 49;
  b3[116] = 98 & ((~b3[64] & idiv(b3[84], 3)) << 1);
  A = (b1[35] & b2[8]) | (b3[40] & ~b2[8]);
  B = (A & b3[64]) | (idiv(b3[84], 3) & ~b3[64]);
  b1[143] = b3[96] - ((B & (86 + ((b1[172] & 64) >> 1))) | (((((b1[172] & 65) >> 1) ^ 86) | ((~b3[64] & idiv(b3[84], 3)) | (((b3[40] & ~b2[8]) | (b1[35] & b2[8])) & b3[64]))) & b3[100]));
  b2[29] = 162;
  A = (((b4[b3[88] % 21] & 160) | (b0[b1[125] % 20] & 95)) >> 1);
  B = b2[b1[149] % 35] ^ mul(b1[43], b1[43]);
  b0[15] += (B & A) | ((A | B) & 115);
  b3[120] = b3[64] - b0[b3[40] % 20];
  b1[95] = b4[b3[20] % 21];
  A = weird_ror8(b2[b3[80] % 35], mul(mul(b2[b1[17] % 35], b2[b1[17] % 35]), b2[b1[17] % 35]) & 7);
  b0[7] -= mul(A, A);
  b2[8] = b2[8] - b1[184] + mul(mul(b4[b1[202] % 21], b4[b1[202] % 21]), b4[b1[202] % 21]);
  b0[16] = (b2[b1[102] % 35] << 1) & 132;
  b3[124] = (b4[b3[40] % 21] >> 1) ^ b3[68];
  b0[7] -= b0[b1[191] % 20] - (((b4[b1[80] % 21] << 1) & ~177) | (b4[b4[b3[88] % 21] % 21] & 177));
  b0[6] = b0[b1[119] % 20];
  A = (b4[b1[190] % 21] & ~209) | (b1[118] & 209);
  B = mul(b0[b3[120] % 20], b0[b3[120] % 20]);
  b0[12] = (b0[b3[84] % 20] ^ (b2[b1[71] % 35] + b2[b1[15] % 35])) & ((A & B) | ((A | B) & 27));
  B = (b1[32] & b2[b3[88] % 35]) | ((b1[32] | b2[b3[88] % 35]) & 23);
  D = ((mul(b4[b1[57] % 21], 231) & 169) | (B & 86));
  F = (((b0[b1[82] % 20] & ~29) | (b4[b3[124] % 21] & 29)) & 190) | (b4[idiv(D, 5) % 21] & ~190);
  H = mul(mul(b0[b3[40] % 20], b0[b3[40] % 20]), b0[b3[40] % 20]);
  K = (H & b1[82]) | (H & 92) | (b1[82] & 92);
  b3[128] = ((F & K) | ((F | K) & 192)) ^ idiv(D, 5);
  b2[25] ^= mul(b0[b3[120] % 20] << 1, b1[5]) - (weird_rol8(b3[76], b4[b3[124] % 21] & 7) & (b3[20] + 110));
}

// --- sap_hash (sap_hash.c) ------------------------------------------------
const SAP_B0 = [0x96, 0x5f, 0xc6, 0x53, 0xf8, 0x46, 0xcc, 0x18, 0xdf, 0xbe, 0xb2, 0xf8, 0x38, 0xd7, 0xec, 0x22, 0x03, 0xd1, 0x20, 0x8f];
const SAP_B2 = [0x43, 0x54, 0x62, 0x7a, 0x18, 0xc3, 0xd6, 0xb3, 0x9a, 0x56, 0xf6, 0x1c, 0x14, 0x3f, 0x0c, 0x1d, 0x3b, 0x36, 0x83, 0xb1, 0x39, 0x51, 0x4a, 0xaa, 0x09, 0x3e, 0xfe, 0x44, 0xaf, 0xde, 0xc3, 0x20, 0x9d, 0x42, 0x3a];
const SAP_B4 = [0xed, 0x25, 0xd1, 0xbb, 0xbc, 0x27, 0x9f, 0x02, 0xa2, 0xa9, 0x11, 0x00, 0x0c, 0xb3, 0x52, 0xc0, 0xbd, 0xe3, 0x1b, 0x49, 0xc7];
const SAP_I0 = [18, 22, 23, 0, 5, 19, 32, 31, 10, 21, 30];

function sap_hash(blockIn, bi, keyOut) {
  const buffer0 = Uint8Array.from(SAP_B0);
  const buffer1 = new Uint8Array(210);
  const buffer2 = Uint8Array.from(SAP_B2);
  const buffer3 = new Uint8Array(132);
  const buffer4 = Uint8Array.from(SAP_B4);

  for (let i = 0; i < 210; i++) {
    const wordIdx = (i % 64) >> 2;
    const inWord = rd32(blockIn, bi + wordIdx * 4);
    buffer1[i] = (inWord >>> ((3 - (i % 4)) << 3)) & 0xff;
  }
  for (let i = 0; i < 840; i++) {
    const x = buffer1[((i - 155) >>> 0) % 210];
    const y = buffer1[((i - 57) >>> 0) % 210];
    const z = buffer1[((i - 13) >>> 0) % 210];
    const w = buffer1[(i >>> 0) % 210];
    buffer1[i % 210] = (rol8(y, 5) + (rol8(z, 3) ^ w) - rol8(x, 7)) & 0xff;
  }
  garble(buffer0, buffer1, buffer2, buffer3, buffer4);

  for (let i = 0; i < 16; i++) keyOut[i] = 0xe1;
  for (let i = 0; i < 11; i++) {
    if (i === 3) keyOut[i] = 0x3d;
    else keyOut[i] = (keyOut[i] + buffer3[SAP_I0[i] * 4]) & 0xff;
  }
  for (let i = 0; i < 20; i++) keyOut[i % 16] ^= buffer0[i];
  for (let i = 0; i < 35; i++) keyOut[i % 16] ^= buffer2[i];
  for (let i = 0; i < 210; i++) keyOut[i % 16] ^= buffer1[i];
  // Reverse-scramble: C reads/writes keyOut live (later reads see earlier
  // writes within the same pass), so we must NOT snapshot.
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const x = keyOut[((i - 7) >>> 0) % 16];
      const y = keyOut[i % 16];
      const z = keyOut[((i - 37) >>> 0) % 16];
      const w = keyOut[((i - 177) >>> 0) % 16];
      keyOut[i] = rol8(x, 1) ^ y ^ rol8(z, 6) ^ rol8(w, 5);
    }
  }
}

// --- generate_session_key (omg_hax.c) -------------------------------------
function generate_session_key(oldSap, messageIn) {
  const decrypted = decryptMessage(messageIn);
  const newSap = new Uint8Array(320);
  newSap.set(T.static_source_1.subarray(0, 0x11), 0x000);
  newSap.set(decrypted.subarray(0, 0x80), 0x011);
  newSap.set(oldSap.subarray(0x80, 0x80 + 0x80), 0x091);
  newSap.set(T.static_source_2.subarray(0, 0x2f), 0x111);

  const sessionKey = Uint8Array.from(T.initial_session_key);
  for (let round = 0; round < 5; round++) {
    const base = round * 64;
    const md5 = modified_md5(newSap, base, sessionKey);
    sap_hash(newSap, base, sessionKey);
    for (let i = 0; i < 4; i++) {
      wr32(sessionKey, i * 4, u32(rd32(sessionKey, i * 4) + rd32(md5, i * 4)));
    }
  }
  for (let i = 0; i < 16; i += 4) {
    let t = sessionKey[i];
    sessionKey[i] = sessionKey[i + 3];
    sessionKey[i + 3] = t;
    t = sessionKey[i + 1];
    sessionKey[i + 1] = sessionKey[i + 2];
    sessionKey[i + 2] = t;
  }
  for (let i = 0; i < 16; i++) sessionKey[i] ^= 121;
  return sessionKey;
}

// --- playfair_decrypt (playfair.c) ----------------------------------------
/**
 * @param {Buffer} message3  164-byte fp-setup phase-2 message (fp.keyMessage)
 * @param {Buffer} cipherText 72-byte ekey
 * @returns {Buffer} 16-byte AES stream key
 */
const DBG = !!process.env.PLAYFAIR_DEBUG;
function dbg(label, u8) {
  if (DBG) console.error(`JS  ${label.padEnd(14)}${Buffer.from(u8).toString('hex')}`);
}

function playfairDecrypt(message3, cipherText) {
  const msg = Uint8Array.from(message3);
  const ct = Uint8Array.from(cipherText);
  const chunk1Off = 16;
  const chunk2Off = 56;

  const sapKey = generate_session_key(Uint8Array.from(T.default_sap), msg);
  dbg('sapKey', sapKey);
  const ks = generate_key_schedule(sapKey);
  if (DBG) {
    const ksBytes = new Uint8Array(44 * 4);
    for (let r = 0; r < 11; r++) for (let w = 0; w < 4; w++) wr32(ksBytes, (r * 4 + w) * 4, ks[r][w]);
    dbg('ks', ksBytes);
  }

  const blockIn = new Uint8Array(16);
  z_xor(ct, chunk2Off, blockIn, 0, 1);
  dbg('blockIn_pre', blockIn);
  cycle(blockIn, ks);
  dbg('blockIn_post', blockIn);
  const keyOut = new Uint8Array(16);
  for (let i = 0; i < 16; i++) keyOut[i] = blockIn[i] ^ ct[chunk1Off + i];
  x_xor(keyOut, 0, keyOut, 0, 1);
  z_xor(keyOut, 0, keyOut, 0, 1);
  dbg('keyOut', keyOut);
  return Buffer.from(keyOut);
}

module.exports = { playfairDecrypt };
