// Dessin d'un code-barres EAN-13 en SVG (pour afficher / imprimer des codes à scanner).
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((s) => s.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function isEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

// Renvoie un élément <svg>, ou null si le code n'est pas un EAN-13 valide.
export function ean13Svg(code, { height = 70, module = 2 } = {}) {
  if (!isEan13(code)) return null;
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const quiet = 11;
  const width = (bits.length + quiet * 2) * module;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height + 16}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height + 16);
  let path = '';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') path += `M${(quiet + i) * module} 0h${module}v${height}h-${module}z`;
  }
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', width);
  bg.setAttribute('height', height + 16);
  bg.setAttribute('fill', '#fff');
  const bars = document.createElementNS(ns, 'path');
  bars.setAttribute('d', path);
  bars.setAttribute('fill', '#000');
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', width / 2);
  text.setAttribute('y', height + 13);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-family', 'monospace');
  text.setAttribute('font-size', '13');
  text.textContent = code;
  svg.append(bg, bars, text);
  return svg;
}
