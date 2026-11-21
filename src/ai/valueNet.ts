// valueNet — a small MLP over the board encoding (encode.ts): P(the Shadow wins).
//
// Trained by scripts/train-value-net.mjs on self-play positions (scripts/selfplay-gen.mjs);
// see docs/ai-selfplay-plan.md. Layout: inputs scaled by 1/std (NOT centred, so the many
// empty region channels stay zero and the first layer is a sparse sum) → H1 ReLU → H2 ReLU
// → sigmoid. W1 is input-major (W1[i * H1 + j]) for that sparse sum.
// Pure and synchronous; the weights are passed in (no file access here).
import type { GameState, Side } from '../engine/types';
import { encode, INPUT_SIZE, ENCODING_VERSION } from './encode';

export interface ValueNetWeights {
  encodingVersion: number; inputSize: number; h1: number; h2: number;
  scale: number[]; W1: number[]; b1: number[]; W2: number[]; b2: number[]; W3: number[]; b3: number;
}

export interface ValueNet {
  /** P(Shadow wins) for an encoded position. */
  probEncoded(x: Uint8Array): number;
  /** P(Shadow wins) for a state (a won game is 0 or 1). */
  shadowWinProb(state: GameState): number;
  /** The state's value for `side`, in [-1, 1]. */
  value(state: GameState, side: Side): number;
}

export function loadValueNet(w: ValueNetWeights): ValueNet {
  if (w.encodingVersion !== ENCODING_VERSION || w.inputSize !== INPUT_SIZE) {
    throw new Error(`value net was trained on encoding v${w.encodingVersion}/${w.inputSize}, current is v${ENCODING_VERSION}/${INPUT_SIZE}`);
  }
  const { h1: H1, h2: H2 } = w;
  const scale = Float32Array.from(w.scale), W1 = Float32Array.from(w.W1), b1 = Float32Array.from(w.b1);
  const W2 = Float32Array.from(w.W2), b2 = Float32Array.from(w.b2), W3 = Float32Array.from(w.W3);
  const a1 = new Float32Array(H1), a2 = new Float32Array(H2);
  const buf = new Uint8Array(INPUT_SIZE);
  const probEncoded = (x: Uint8Array): number => {
    a1.set(b1);
    for (let i = 0; i < INPUT_SIZE; i++) {
      const xi = x[i]!;
      if (!xi) continue;
      const v = xi * scale[i]!, o = i * H1;
      for (let j = 0; j < H1; j++) a1[j]! += v * W1[o + j]!;
    }
    for (let j = 0; j < H1; j++) if (a1[j]! < 0) a1[j] = 0;
    for (let k = 0; k < H2; k++) {
      let z = b2[k]!;
      const o = k * H1;
      for (let j = 0; j < H1; j++) z += W2[o + j]! * a1[j]!;
      a2[k] = z > 0 ? z : 0;
    }
    let z = w.b3;
    for (let k = 0; k < H2; k++) z += W3[k]! * a2[k]!;
    return 1 / (1 + Math.exp(-z));
  };
  const shadowWinProb = (s: GameState): number => (s.winner ? (s.winner === 'shadow' ? 1 : 0) : probEncoded(encode(s, buf)));
  return {
    probEncoded,
    shadowWinProb,
    value: (s, side) => { const p = shadowWinProb(s); return side === 'shadow' ? 2 * p - 1 : 1 - 2 * p; },
  };
}
