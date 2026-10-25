describe('pdf-dom-polyfills', () => {
  const ORIGINAL = {
    DOMMatrix: (globalThis as any).DOMMatrix,
    Path2D: (globalThis as any).Path2D,
    ImageData: (globalThis as any).ImageData,
  };

  afterEach(() => {
    (globalThis as any).DOMMatrix = ORIGINAL.DOMMatrix;
    (globalThis as any).Path2D = ORIGINAL.Path2D;
    (globalThis as any).ImageData = ORIGINAL.ImageData;
    jest.resetModules();
  });

  it('defines DOMMatrix, Path2D, and ImageData on globalThis when missing', () => {
    delete (globalThis as any).DOMMatrix;
    delete (globalThis as any).Path2D;
    delete (globalThis as any).ImageData;
    jest.resetModules();

    require('./pdf-dom-polyfills');

    expect(() => new (globalThis as any).DOMMatrix()).not.toThrow();
    expect(() => new (globalThis as any).Path2D()).not.toThrow();
    expect(() => new (globalThis as any).ImageData(1, 1)).not.toThrow();
  });

  it('does not override an already-defined DOMMatrix', () => {
    class RealDOMMatrix {}
    (globalThis as any).DOMMatrix = RealDOMMatrix;
    jest.resetModules();

    require('./pdf-dom-polyfills');

    expect((globalThis as any).DOMMatrix).toBe(RealDOMMatrix);
  });

  it('constructs ImageData from a width/height pair with a correctly-sized buffer', () => {
    delete (globalThis as any).ImageData;
    jest.resetModules();
    require('./pdf-dom-polyfills');

    const image = new (globalThis as any).ImageData(2, 3);

    expect(image.width).toBe(2);
    expect(image.height).toBe(3);
    expect(image.data.length).toBe(2 * 3 * 4);
  });
});
