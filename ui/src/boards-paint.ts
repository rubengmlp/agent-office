import type { BoardData, BoardTone } from './boards';

export const BOARD_W = 512;
export const BOARD_H = 320;

const PAPER = '#f7f9fb';
const INK = '#1f2937';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MARGIN = 22;
const BAR_W = 110;

type Metrics = { title: number; titleY: number; font: number; linesY: number; step: number; lines: number; dot: number };

const NORMAL: Metrics = { title: 30, titleY: 38, font: 22, linesY: 84, step: 29.5, lines: 8, dot: 6.5 };
// The 2D sprite is small on screen: bigger letters, fewer lines.
const LARGE: Metrics = { title: 42, titleY: 48, font: 31, linesY: 104, step: 40, lines: 6, dot: 8.5 };

const TONES: Record<BoardTone, string> = {
  plain: INK,
  ok: '#15803d',
  warn: '#b45309',
  danger: '#dc2626',
  muted: '#6b7280',
};

function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && g.measureText(`${text.slice(0, end)}…`).width > width) end -= 1;
  return `${text.slice(0, end)}…`;
}

// Draws the board on a canvas of BOARD_W x BOARD_H: dark ink on white, the accent of the floor under the title.
export function paintBoard(g: CanvasRenderingContext2D, data: BoardData, accent: string, large = false): void {
  const m = large ? LARGE : NORMAL;
  g.clearRect(0, 0, BOARD_W, BOARD_H);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, BOARD_W, BOARD_H);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  g.font = `700 ${m.title}px ${FONT}`;
  g.fillStyle = INK;
  g.fillText(fit(g, data.title, BOARD_W - MARGIN * 2), MARGIN, m.titleY);
  g.fillStyle = accent;
  g.fillRect(MARGIN, m.titleY + 10, BOARD_W - MARGIN * 2, 4);

  g.font = `500 ${m.font}px ${FONT}`;
  data.lines.slice(0, m.lines).forEach((line, index) => {
    const y = m.linesY + index * m.step;
    const reserved = line.bar === undefined ? 0 : BAR_W + 12;
    const indent = line.dot ? m.dot * 3 : 0;
    if (line.dot) {
      g.fillStyle = line.dot;
      g.beginPath();
      g.arc(MARGIN + m.dot, y - m.dot, m.dot, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = TONES[line.tone];
    g.fillText(fit(g, line.text, BOARD_W - MARGIN * 2 - indent - reserved), MARGIN + indent, y);
    if (line.bar !== undefined) {
      const x = BOARD_W - MARGIN - BAR_W;
      g.fillStyle = '#d9dee5';
      g.fillRect(x, y - m.font * 0.68, BAR_W, m.font * 0.55);
      g.fillStyle = TONES[line.tone];
      g.fillRect(x, y - m.font * 0.68, (BAR_W * line.bar) / 100, m.font * 0.55);
    }
  });
}
