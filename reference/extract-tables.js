'use strict';
// Extract all FairPlay/playfair lookup tables from the RPiPlay C reference
// (GPLv3) into a byte-accurate JS data module. Run from project root:
//   node reference/extract-tables.js

const fs = require('fs');

const hx = fs.readFileSync('reference/rpiplay/playfair__omg_hax.h', 'utf8');
const oc = fs.readFileSync('reference/rpiplay/playfair__omg_hax.c', 'utf8');

/** Extract the numbers inside the (first) initializer of `name` in `src`. */
function extractNumbers(src, name) {
  // Match: <type> name [dims] = { .... } ;   (dims/braces arbitrary)
  const re = new RegExp(`\\b${name}\\s*(\\[[^\\]]*\\])+\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`array not found: ${name}`);
  let i = m.index + m[0].length - 1; // at first '{'
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(start, i + 1);
  const nums = body.match(/0x[0-9a-fA-F]+|\b\d+\b/g).map((t) => parseInt(t, 16 === 0 ? 10 : undefined) || Number(t));
  // parseInt above is unreliable for decimals; redo cleanly:
  return body.match(/0x[0-9a-fA-F]+|\d+/g).map((t) => (t.startsWith('0x') ? parseInt(t, 16) : parseInt(t, 10)));
}

const u8 = (name, src = hx) => Buffer.from(extractNumbers(src, name).map((n) => n & 0xff));
const u32 = (name, src = hx) => Uint32Array.from(extractNumbers(src, name).map((n) => n >>> 0));

const tables = {
  // 8-bit tables
  z_key: u8('z_key'),
  x_key: u8('x_key'),
  t_key: u8('t_key'),
  table_s1: u8('table_s1'),
  table_s2: u8('table_s2'),
  table_s3: u8('table_s3'),
  table_s4: u8('table_s4'),
  table_s10: u8('table_s10'),
  message_iv: u8('message_iv'),
  message_key: u8('message_key'),
  // 32-bit tables
  table_s5: u32('table_s5'),
  table_s6: u32('table_s6'),
  table_s7: u32('table_s7'),
  table_s8: u32('table_s8'),
  table_s9: u32('table_s9'),
  // arrays from omg_hax.c
  sap_key_material: u8('sap_key_material', oc),
  index_mangle: u8('index_mangle', oc),
  initial_session_key: u8('initial_session_key', oc),
  static_source_1: u8('static_source_1', oc),
  static_source_2: u8('static_source_2', oc),
  default_sap: u8('default_sap', oc),
};

// Expected sizes (validation)
const expect = {
  z_key: 16, x_key: 16, t_key: 16,
  table_s1: 0x28 * 256, table_s2: 144 * 256, table_s3: 16 * 256, table_s4: 144 * 256, table_s10: 16 * 256,
  message_iv: 4 * 16, message_key: 4 * 144,
  table_s5: 256, table_s6: 256, table_s7: 256, table_s8: 256, table_s9: 1024,
  sap_key_material: 16, index_mangle: 11, initial_session_key: 16, static_source_1: 17, static_source_2: 47,
};
let ok = true;
for (const [k, v] of Object.entries(tables)) {
  const len = v.length;
  const exp = expect[k];
  const status = exp === undefined ? '(no check)' : len === exp ? 'OK' : `*** EXPECTED ${exp} ***`;
  if (exp !== undefined && len !== exp) ok = false;
  console.log(`${k.padEnd(20)} ${String(len).padStart(6)} ${v.constructor.name.padEnd(12)} ${status}`);
}
console.log('default_sap length =', tables.default_sap.length);

// Emit JS module: base64 for u8 tables, plain arrays for u32 tables.
const q = "'";
let out = "'use strict';\n// AUTO-EXTRACTED from RPiPlay playfair (GPLv3) via reference/extract-tables.js. Do not edit.\n";
out += 'module.exports = {\n';
for (const [k, v] of Object.entries(tables)) {
  if (v instanceof Uint32Array) {
    out += `  ${k}: Uint32Array.from([${Array.from(v).join(',')}]),\n`;
  } else {
    out += `  ${k}: Buffer.from(${q}${v.toString('base64')}${q}, ${q}base64${q}),\n`;
  }
}
out += '};\n';
fs.writeFileSync('src/main/airplay/playfair-tables.js', out);
console.log(ok ? '\nAll size checks PASSED' : '\n*** SIZE CHECK FAILED ***');
console.log('wrote src/main/airplay/playfair-tables.js (' + out.length + ' bytes)');
