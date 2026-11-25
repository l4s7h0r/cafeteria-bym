// Generador de códigos QR (modo byte, corrección de errores nivel M, versiones 1 a 10).
// Implementado acá para no agregar dependencias al proyecto. Devuelve la matriz o un SVG listo para imprimir.

// ---- GF(256) ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generador(grado: number): number[] {
  let g = [1];
  for (let i = 0; i < grado; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] ^= mul(g[j], 1); n[j + 1] ^= mul(g[j], EXP[i]); }
    g = n;
  }
  return g;
}

function ecc(datos: number[], grado: number): number[] {
  const g = generador(grado);
  const res = new Array(grado).fill(0);
  for (const d of datos) {
    const factor = d ^ res[0];
    res.shift(); res.push(0);
    if (factor !== 0) for (let i = 0; i < grado; i++) res[i] ^= mul(g[i + 1], factor);
  }
  return res;
}

// ---- Tablas (nivel M, versiones 1..10) ----
const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
// [ecc por bloque, bloques grupo 1, datos grupo 1, bloques grupo 2, datos grupo 2]
const BLOQUES_M: number[][] = [
  [], [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALINEACION: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const datosCW = (v: number) => { const [, b1, d1, b2, d2] = BLOQUES_M[v]; return b1 * d1 + b2 * d2; };

function bchFormato(datos: number[]) {
  // Información de formato: 5 bits (nivel + máscara) + BCH(15,5), XOR 0x5412
  const nivel = 0b00; // M
  const v = (nivel << 3) | datos[0];
  let resto = v << 10;
  for (let i = 4; i >= 0; i--) if (resto & (1 << (i + 10))) resto ^= 0x537 << i;
  return ((v << 10) | resto) ^ 0x5412;
}
function bchVersion(v: number) {
  let resto = v << 12;
  for (let i = 5; i >= 0; i--) if (resto & (1 << (i + 12))) resto ^= 0x1f25 << i;
  return (v << 12) | resto;
}

// ---- Codificación ----
function bits(texto: string, version: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(texto));
  const out: number[] = [];
  const push = (valor: number, n: number) => { for (let i = n - 1; i >= 0; i--) out.push((valor >> i) & 1); };
  push(0b0100, 4);                       // modo byte
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacidad = datosCW(version) * 8;
  for (let i = 0; i < 4 && out.length < capacidad; i++) out.push(0);   // terminador
  while (out.length % 8 !== 0) out.push(0);
  const relleno = [0xec, 0x11];
  let k = 0;
  while (out.length < capacidad) { push(relleno[k++ % 2], 8); }
  return out;
}

function codewords(texto: string, version: number): number[] {
  const b = bits(texto, version);
  const cw: number[] = [];
  for (let i = 0; i < b.length; i += 8) cw.push(parseInt(b.slice(i, i + 8).join(""), 2));
  const [grado, b1, d1, b2, d2] = BLOQUES_M[version];
  const bloques: number[][] = [], eccs: number[][] = [];
  let p = 0;
  for (let i = 0; i < b1; i++) { const blk = cw.slice(p, p + d1); p += d1; bloques.push(blk); eccs.push(ecc(blk, grado)); }
  for (let i = 0; i < b2; i++) { const blk = cw.slice(p, p + d2); p += d2; bloques.push(blk); eccs.push(ecc(blk, grado)); }
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const blk of bloques) if (i < blk.length) out.push(blk[i]);
  for (let i = 0; i < grado; i++) for (const e of eccs) out.push(e[i]);
  return out;
}

function versionPara(texto: string): number {
  const len = new TextEncoder().encode(texto).length;
  for (let v = 1; v <= 10; v++) {
    const cabecera = 4 + (v < 10 ? 8 : 16);
    if (datosCW(v) * 8 >= cabecera + len * 8) return v;
  }
  throw new Error("Texto demasiado largo para el QR");
}

// ---- Matriz ----
type M = (0 | 1 | null)[][];

function patrones(version: number): { m: M; reservado: boolean[][]; size: number } {
  const size = version * 4 + 17;
  const m: M = Array.from({ length: size }, () => new Array(size).fill(null));
  const reservado = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x: number, y: number, v: 0 | 1) => { m[y][x] = v; reservado[y][x] = true; };

  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d === 2 || d === 4 ? 0 : 1); // anillo oscuro (d=3), anillo claro (d=2), núcleo (d<=1), separador (d=4)
    }
  };
  buscador(3, 3); buscador(size - 4, 3); buscador(3, size - 4);

  // Patrones de alineación
  for (const cy of ALINEACION[version]) for (const cx of ALINEACION[version]) {
    if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx + dx, cy + dy, d === 1 ? 0 : 1);
    }
  }
  // Patrones de temporización
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0 ? 1 : 0); set(6, i, i % 2 === 0 ? 1 : 0); }
  // Módulo oscuro
  set(8, size - 8, 1);
  // Zonas reservadas de formato
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) { m[8][i] = 0; reservado[8][i] = true; } if (m[i][8] === null) { m[i][8] = 0; reservado[i][8] = true; } }
  for (let i = 0; i < 8; i++) { if (m[8][size - 1 - i] === null) { m[8][size - 1 - i] = 0; reservado[8][size - 1 - i] = true; } if (m[size - 1 - i][8] === null) { m[size - 1 - i][8] = 0; reservado[size - 1 - i][8] = true; } }
  // Zona reservada de versión (v >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      m[size - 11 + j][i] = 0; reservado[size - 11 + j][i] = true;
      m[i][size - 11 + j] = 0; reservado[i][size - 11 + j] = true;
    }
  }
  return { m, reservado, size };
}

const MASCARAS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalizacion(m: M, size: number): number {
  let p = 0;
  const at = (x: number, y: number) => (m[y][x] ? 1 : 0);
  // Regla 1: 5+ módulos del mismo color en fila/columna
  for (let i = 0; i < size; i++) {
    for (const fila of [true, false]) {
      let run = 1, prev = fila ? at(0, i) : at(i, 0);
      for (let j = 1; j < size; j++) {
        const v = fila ? at(j, i) : at(i, j);
        if (v === prev) run++; else { if (run >= 5) p += run - 2; run = 1; prev = v; }
      }
      if (run >= 5) p += run - 2;
    }
  }
  // Regla 2: bloques 2x2
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const v = at(x, y);
    if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3;
  }
  // Regla 3: patrón 1:1:3:1:1 con separador
  const patron = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patronInv = [...patron].reverse();
  const coincide = (vals: number[], pat: number[]) => pat.every((v, i) => vals[i] === v);
  for (let i = 0; i < size; i++) for (let j = 0; j <= size - 11; j++) {
    const fila = Array.from({ length: 11 }, (_, k) => at(j + k, i));
    const col = Array.from({ length: 11 }, (_, k) => at(i, j + k));
    for (const vals of [fila, col]) if (coincide(vals, patron) || coincide(vals, patronInv)) p += 40;
  }
  // Regla 4: proporción de oscuros
  let oscuros = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) oscuros += at(x, y);
  const pct = (oscuros * 100) / (size * size);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

export function matrizQR(texto: string): { size: number; modulos: boolean[][]; version: number } {
  const version = versionPara(texto);
  const cw = codewords(texto, version);
  const { m, reservado, size } = patrones(version);

  // Colocación en zigzag (de derecha a izquierda, en pares de columnas)
  const flujo: number[] = [];
  for (const b of cw) for (let i = 7; i >= 0; i--) flujo.push((b >> i) & 1);
  let idx = 0, arriba = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5; // la columna 6 es de temporización
    for (let k = 0; k < size; k++) {
      const y = arriba ? size - 1 - k : k;
      for (const x of [col, col - 1]) {
        if (reservado[y][x]) continue;
        m[y][x] = (idx < flujo.length ? flujo[idx] : 0) as 0 | 1;
        idx++;
      }
    }
    arriba = !arriba;
  }

  // Elegir máscara
  let mejor = { p: Infinity, mask: 0, m: m as M };
  for (let mask = 0; mask < 8; mask++) {
    const copia: M = m.map((f) => [...f]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (reservado[y][x]) continue;
      if (MASCARAS[mask](x, y)) copia[y][x] = (copia[y][x] ? 0 : 1) as 0 | 1;
    }
    // Formato (necesario para medir la penalización real)
    aplicarFormato(copia, size, mask);
    if (version >= 7) aplicarVersion(copia, size, version);
    const p = penalizacion(copia, size);
    if (p < mejor.p) mejor = { p, mask, m: copia };
  }
  return { size, version, modulos: mejor.m.map((f) => f.map((v) => v === 1)) };
}

function aplicarFormato(m: M, size: number, mask: number) {
  const f = bchFormato([mask]);
  const bit = (i: number) => (((f >> i) & 1) ? 1 : 0) as 0 | 1;
  const set = (x: number, y: number, v: 0 | 1) => { m[y][x] = v; };
  // Primera copia (esquina superior izquierda)
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  // Segunda copia (abajo izquierda y arriba derecha)
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, 1); // módulo oscuro
}

function aplicarVersion(m: M, size: number, version: number) {
  const v = bchVersion(version);
  for (let i = 0; i < 18; i++) {
    const b = (((v >> i) & 1) ? 1 : 0) as 0 | 1;
    const fila = Math.floor(i / 3), col = i % 3;
    m[size - 11 + col][fila] = b;
    m[fila][size - 11 + col] = b;
  }
}

// SVG listo para imprimir (sin dependencias). `escala` = px por módulo.
export function qrSvg(texto: string, escala = 4, margen = 4): string {
  const { size, modulos } = matrizQR(texto);
  const total = (size + margen * 2) * escala;
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modulos[y][x]) d += `M${(x + margen) * escala} ${(y + margen) * escala}h${escala}v${escala}h-${escala}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#1E2B26"/></svg>`;
}
