// pdf-parse's bundled pdfjs-dist evaluates `new DOMMatrix()` at module top
// level — it runs the instant `require('pdf-parse')` executes, not lazily.
// pdfjs-dist tries to source DOMMatrix/Path2D/ImageData from the optional,
// native `@napi-rs/canvas` package first, but that package is platform-
// specific and gets dropped from Vercel's serverless function bundle
// (its dynamic require() isn't traceable by Vercel's bundler), leaving
// these globals undefined and crashing the whole process at boot.
//
// We only ever call pdf-parse's getText() (pure text extraction) — never
// its page-rendering path, the only place these actually need to behave
// like real DOM classes — so minimal constructable stubs are enough to
// stop the top-level crash without needing the native canvas package at
// all. Import this before importing 'pdf-parse' anywhere.

class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(_init?: unknown) {}
  multiply(): this {
    return this;
  }
  translate(): this {
    return this;
  }
  scale(): this {
    return this;
  }
  inverse(): this {
    return this;
  }
}

class Path2DPolyfill {
  constructor(_path?: unknown) {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  addPath(): void {}
}

class ImageDataPolyfill {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight = 0,
    height = 0,
  ) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height;
    } else {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = Path2DPolyfill;
}
if (typeof (globalThis as any).ImageData === 'undefined') {
  (globalThis as any).ImageData = ImageDataPolyfill;
}
