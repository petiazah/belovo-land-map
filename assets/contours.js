/* Transparent contour extraction for the 2026/2027 PDF map sheets.
   Show only colored linework above the satellite image; the PDF paper and
   neutral gray reference marks are discarded. Original sheets are unchanged. */
(() => {
  'use strict';

  function create(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) throw new Error('Canvas 2D not available');
    ctx.drawImage(image, 0, 0);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = pixels.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const magenta = Math.min(r - g, b - g);
      const cyan = Math.min(g - r, b - r);
      const red = r - Math.max(g, b);
      const blue = b - Math.max(r, g);
      const green = g - Math.max(r, b);
      const yellow = Math.min(r - b, g - b);
      let a = 0;

      // PDF boundary colors: bright magenta and violet.
      if (magenta > 13 && r > 94 && b > 88) {
        a = Math.min(255, Math.round((magenta - 10) * 5.4));
        d[i] = 240; d[i + 1] = 20; d[i + 2] = 215;
      }
      // Cyan lines: light parcel fills fade, stronger linework stays visible.
      else if (cyan > 19 && g > 88 && b > 94) {
        a = Math.min(255, Math.round((cyan - 17) * 3.6));
        d[i] = 19; d[i + 1] = 182; d[i + 2] = 235;
      }
      // Other vivid map annotations (red, blue, green, yellow).
      else if (red > 27 && r > 128) {
        a = Math.min(255, Math.round((red - 23) * 4.0));
        d[i] = 239; d[i + 1] = 44; d[i + 2] = 48;
      }
      else if (blue > 32 && b > 125) {
        a = Math.min(255, Math.round((blue - 28) * 3.8));
        d[i] = 48; d[i + 1] = 112; d[i + 2] = 244;
      }
      else if (green > 38 && g > 123) {
        a = Math.min(255, Math.round((green - 35) * 3.0));
        d[i] = 30; d[i + 1] = 185; d[i + 2] = 104;
      }
      else if (yellow > 53 && r > 155 && g > 132) {
        a = Math.min(255, Math.round((yellow - 48) * 3.0));
        d[i] = 249; d[i + 1] = 184; d[i + 2] = 38;
      }
      // White/off-white paper, neutral map fill and neutral text: clear alpha.
      d[i + 3] = a;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  window.BELOVO_CONTOURS = {create};
})();
