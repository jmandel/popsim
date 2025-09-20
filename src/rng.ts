const TAU = 0x9e3779b9;

function mix(seed: number, value: number): number {
  let x = (seed ^ value) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return x ^ (x >>> 16);
}

function hashString(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), TAU);
  }
  return mix(h, str.length);
}

export class RNG {
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) seed = 0;
    this.state = seed >>> 0 || 1;
  }

  private next(): number {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }

  float(): number {
    const u = this.next();
    return u === 1 ? 0.9999999995 : u;
  }

  normal(mu = 0, sigma = 1): number {
    const u = this.float() || 1e-12;
    const v = this.float() || 1e-12;
    const mag = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    return mu + sigma * mag * Math.cos(angle);
  }

  expo(rate: number): number {
    if (!(rate > 0)) return Number.POSITIVE_INFINITY;
    const u = this.float() || 1e-12;
    return -Math.log(1 - u) / rate;
  }

  child(namespace: string): RNG {
    const seed = mix(this.state, hashString(namespace, this.state ^ TAU));
    return new RNG(seed);
  }
}
