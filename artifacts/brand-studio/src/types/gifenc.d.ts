declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame(
      indexed: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Uint8Array; delay?: number; repeat?: number }
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8Array, maxColors: number): Uint8Array;
  export function applyPalette(rgba: Uint8Array, palette: Uint8Array): Uint8Array;
}
