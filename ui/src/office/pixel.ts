import { Text, type Graphics } from 'pixi.js';
import { SCALE } from './constants';

export function bitmap(
  g: Graphics,
  rows: readonly string[],
  x: number,
  y: number,
  colors: Readonly<Record<string, number>>,
): Graphics {
  rows.forEach((row, rowIndex) => {
    let start = 0;
    while (start < row.length) {
      const symbol = row[start];
      let end = start;
      while (end + 1 < row.length && row[end + 1] === symbol) end += 1;
      const color = colors[symbol];
      if (color !== undefined) g.rect(x + start, y + rowIndex, end - start + 1, 1).fill(color);
      start = end + 1;
    }
  });
  return g;
}

export function px(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): Graphics {
  return g.rect(x, y, w, h).fill(alpha === 1 ? color : { color, alpha });
}

export function makeText(value: string, size: number, color: number): Text {
  const text = new Text({
    text: value,
    style: { fontFamily: 'monospace', fontSize: size * SCALE, fill: color },
  });
  text.scale.set(1 / SCALE);
  return text;
}
