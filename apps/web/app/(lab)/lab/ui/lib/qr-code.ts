import QRCode from "qrcode";

/**
 * Renders a QR code as an inline-SVG data URL, computed synchronously from
 * `qrcode`'s module matrix (`QRCode.create`) — no canvas, no async I/O, and
 * no network fetch, matching the lab's same-origin-only image rule.
 */
export function qrCodeDataUrl(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const cell = 4;
  const margin = 4;
  const dimension = (modules.size + margin * 2) * cell;

  let cells = "";
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col) === 1) {
        cells += `<rect x="${(col + margin) * cell}" y="${(row + margin) * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}">` +
    `<rect width="${dimension}" height="${dimension}" fill="#fff"/>` +
    `<g fill="#000">${cells}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
