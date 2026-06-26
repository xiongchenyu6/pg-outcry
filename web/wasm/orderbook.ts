// OUTCRY order-book engine — AssemblyScript → WebAssembly.
//
// Ingests the live L2 stream (md:<symbol> broadcast 'l2') and computes, in native
// wasm, the things the UI repaints every tick: best bid/ask, spread, mid,
// cumulative depth for the depth chart, and a banker's-rounding cost preview that
// is bit-identical to the engine's settlement rounding (banker_round / oc_fastmath).

const MAX: i32 = 512;
let bidPrice = new StaticArray<f64>(MAX);
let bidVol   = new StaticArray<f64>(MAX);
let askPrice = new StaticArray<f64>(MAX);
let askVol   = new StaticArray<f64>(MAX);
let nBid: i32 = 0;
let nAsk: i32 = 0;

// 0 = bids (caller passes price desc), 1 = asks (price asc)
export function reset(side: i32): void { if (side == 0) nBid = 0; else nAsk = 0; }

export function push(side: i32, price: f64, vol: f64): void {
  if (side == 0) { if (nBid < MAX) { bidPrice[nBid] = price; bidVol[nBid] = vol; nBid++; } }
  else           { if (nAsk < MAX) { askPrice[nAsk] = price; askVol[nAsk] = vol; nAsk++; } }
}

export function bidCount(): i32 { return nBid; }
export function askCount(): i32 { return nAsk; }
export function priceAt(side: i32, i: i32): f64 { return side == 0 ? bidPrice[i] : askPrice[i]; }
export function volAt(side: i32, i: i32): f64 { return side == 0 ? bidVol[i] : askVol[i]; }

export function bestBid(): f64 { return nBid > 0 ? bidPrice[0] : 0; }
export function bestAsk(): f64 { return nAsk > 0 ? askPrice[0] : 0; }
export function spread(): f64 { return (nBid > 0 && nAsk > 0) ? askPrice[0] - bidPrice[0] : 0; }
export function spreadBps(): f64 {
  let m = mid();
  return m > 0 ? (spread() / m) * 10000.0 : 0;
}
export function mid(): f64 { return (nBid > 0 && nAsk > 0) ? (askPrice[0] + bidPrice[0]) / 2.0 : 0; }

// cumulative depth up to level i (inclusive)
export function cumBid(i: i32): f64 { let s: f64 = 0; for (let k = 0; k <= i && k < nBid; k++) s += bidVol[k]; return s; }
export function cumAsk(i: i32): f64 { let s: f64 = 0; for (let k = 0; k <= i && k < nAsk; k++) s += askVol[k]; return s; }
export function maxCum(): f64 {
  let b: f64 = nBid > 0 ? cumBid(nBid - 1) : 0;
  let a: f64 = nAsk > 0 ? cumAsk(nAsk - 1) : 0;
  return b > a ? b : a;
}

// total liquidity available within `depth` price units of mid (imbalance helper)
export function imbalance(): f64 {
  let b = nBid > 0 ? cumBid(nBid - 1) : 0;
  let a = nAsk > 0 ? cumAsk(nAsk - 1) : 0;
  let t = b + a;
  return t > 0 ? (b - a) / t : 0;   // -1..1, >0 = bid-heavy
}

// Banker's rounding (round half to even) — matches engine banker_round / oc_fastmath.
export function bankerRound(x: f64, prec: i32): f64 {
  let scale = NativeMath.pow(10.0, <f64>prec);
  let scaled = x * scale;
  let fl = NativeMath.floor(scaled);
  let frac = scaled - fl;
  let r: f64;
  if (frac > 0.5)      r = fl + 1.0;
  else if (frac < 0.5) r = fl;
  else                 r = (<i64>fl) % 2 == 0 ? fl : fl + 1.0;  // half → even
  return r / scale;
}

// Estimated quote reserved for a LIMIT BUY of `amount` @ `price` at `prec` decimals.
export function quoteCost(amount: f64, price: f64, prec: i32): f64 {
  return bankerRound(amount * price, prec);
}

// ───────────────────────── candlestick aggregation ─────────────────────────
// Trades are streamed in (ts seconds, price, amount) and bucketed into OHLCV
// candles of `interval` seconds — entirely in wasm, so the chart re-aggregates
// instantly when the timeframe changes.
const MAXC: i32 = 600;
let cTime  = new StaticArray<f64>(MAXC);
let cOpen  = new StaticArray<f64>(MAXC);
let cHigh  = new StaticArray<f64>(MAXC);
let cLow   = new StaticArray<f64>(MAXC);
let cClose = new StaticArray<f64>(MAXC);
let cVol   = new StaticArray<f64>(MAXC);
let nC: i32 = 0;
let interval: f64 = 60.0;

export function candleReset(): void { nC = 0; }
export function candleSetInterval(sec: f64): void { interval = sec > 0 ? sec : 60.0; }

export function addTrade(tsSec: f64, price: f64, amount: f64): void {
  let b = NativeMath.floor(tsSec / interval) * interval;
  if (nC > 0 && cTime[nC - 1] == b) {
    let i = nC - 1;
    if (price > cHigh[i]) cHigh[i] = price;
    if (price < cLow[i])  cLow[i]  = price;
    cClose[i] = price; cVol[i] += amount;
  } else if (nC > 0 && b < cTime[nC - 1]) {
    let i = nC - 1;                        // out-of-order: fold into last
    if (price > cHigh[i]) cHigh[i] = price;
    if (price < cLow[i])  cLow[i]  = price;
    cVol[i] += amount;
  } else {
    if (nC == MAXC) {                       // full: drop oldest
      for (let k = 1; k < MAXC; k++) {
        cTime[k-1]=cTime[k]; cOpen[k-1]=cOpen[k]; cHigh[k-1]=cHigh[k];
        cLow[k-1]=cLow[k]; cClose[k-1]=cClose[k]; cVol[k-1]=cVol[k];
      }
      nC = MAXC - 1;
    }
    cTime[nC]=b; cOpen[nC]=price; cHigh[nC]=price; cLow[nC]=price; cClose[nC]=price; cVol[nC]=amount;
    nC++;
  }
}
export function candleCount(): i32 { return nC; }
export function candleTime(i: i32): f64 { return cTime[i]; }
export function candleOpen(i: i32): f64 { return cOpen[i]; }
export function candleHigh(i: i32): f64 { return cHigh[i]; }
export function candleLow(i: i32): f64 { return cLow[i]; }
export function candleClose(i: i32): f64 { return cClose[i]; }
export function candleVol(i: i32): f64 { return cVol[i]; }
export function candleMin(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; if (nC == 0) return 0;
  let m = cLow[s]; for (let i = s + 1; i < nC; i++) if (cLow[i] < m) m = cLow[i]; return m;
}
export function candleMax(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; if (nC == 0) return 0;
  let m = cHigh[s]; for (let i = s + 1; i < nC; i++) if (cHigh[i] > m) m = cHigh[i]; return m;
}
export function candleVolMax(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; let m: f64 = 0;
  for (let i = s; i < nC; i++) if (cVol[i] > m) m = cVol[i]; return m;
}

// ── moving averages over close (computed in wasm, read per-candle for overlay) ──
let smaVal = new StaticArray<f64>(MAXC);
let emaVal = new StaticArray<f64>(MAXC);

// Simple moving average of close, period `p`. NaN where not enough history.
export function computeSma(p: i32): void {
  let sum: f64 = 0;
  for (let i = 0; i < nC; i++) {
    sum += cClose[i];
    if (i >= p) sum -= cClose[i - p];
    smaVal[i] = i >= p - 1 ? sum / (<f64>p) : NaN;
  }
}
// Exponential moving average of close, period `p`, seeded with the first SMA(p).
export function computeEma(p: i32): void {
  let k: f64 = 2.0 / (<f64>p + 1.0);
  let prev: f64 = 0; let seeded = false;
  for (let i = 0; i < nC; i++) {
    if (!seeded) {
      if (i == p - 1) {
        let s: f64 = 0; for (let j = 0; j < p; j++) s += cClose[j];
        prev = s / (<f64>p); emaVal[i] = prev; seeded = true;
      } else emaVal[i] = NaN;
    } else {
      prev = cClose[i] * k + prev * (1.0 - k); emaVal[i] = prev;
    }
  }
}
export function smaAt(i: i32): f64 { return smaVal[i]; }
export function emaAt(i: i32): f64 { return emaVal[i]; }

// ── Bollinger Bands: SMA(p) ± mult·stddev(close, p) ──
let bbUp = new StaticArray<f64>(MAXC);
let bbLo = new StaticArray<f64>(MAXC);
let bbMid = new StaticArray<f64>(MAXC);
export function computeBoll(p: i32, mult: f64): void {
  for (let i = 0; i < nC; i++) {
    if (i < p - 1) { bbUp[i] = NaN; bbLo[i] = NaN; bbMid[i] = NaN; continue; }
    let sum: f64 = 0;
    for (let j = i - p + 1; j <= i; j++) sum += cClose[j];
    let mean = sum / (<f64>p);
    let v: f64 = 0;
    for (let j = i - p + 1; j <= i; j++) { let d = cClose[j] - mean; v += d * d; }
    let sd = NativeMath.sqrt(v / (<f64>p));
    bbMid[i] = mean; bbUp[i] = mean + mult * sd; bbLo[i] = mean - mult * sd;
  }
}
export function bollUp(i: i32): f64 { return bbUp[i]; }
export function bollLo(i: i32): f64 { return bbLo[i]; }
export function bollMid(i: i32): f64 { return bbMid[i]; }

// ── volume moving average ──
let volMaV = new StaticArray<f64>(MAXC);
export function computeVolSma(p: i32): void {
  let sum: f64 = 0;
  for (let i = 0; i < nC; i++) {
    sum += cVol[i];
    if (i >= p) sum -= cVol[i - p];
    volMaV[i] = i >= p - 1 ? sum / (<f64>p) : NaN;
  }
}
export function volSmaAt(i: i32): f64 { return volMaV[i]; }

// ── RSI (Wilder's smoothing) ──
let rsiVal = new StaticArray<f64>(MAXC);
export function computeRsi(p: i32): void {
  if (nC == 0) return;
  rsiVal[0] = NaN;
  let avgG: f64 = 0, avgL: f64 = 0;
  for (let i = 1; i < nC; i++) {
    let ch = cClose[i] - cClose[i - 1];
    let g = ch > 0 ? ch : 0.0;
    let l = ch < 0 ? -ch : 0.0;
    if (i <= p) {
      avgG += g; avgL += l;
      if (i == p) { avgG /= <f64>p; avgL /= <f64>p; rsiVal[i] = avgL == 0 ? 100.0 : 100.0 - 100.0 / (1.0 + avgG / avgL); }
      else rsiVal[i] = NaN;
    } else {
      avgG = (avgG * (<f64>(p - 1)) + g) / (<f64>p);
      avgL = (avgL * (<f64>(p - 1)) + l) / (<f64>p);
      rsiVal[i] = avgL == 0 ? 100.0 : 100.0 - 100.0 / (1.0 + avgG / avgL);
    }
  }
}
export function rsiAt(i: i32): f64 { return rsiVal[i]; }

// ── MACD (fast/slow/signal EMAs) ──
let macdVal = new StaticArray<f64>(MAXC);
let macdSig = new StaticArray<f64>(MAXC);
let macdHist = new StaticArray<f64>(MAXC);
let ema1 = new StaticArray<f64>(MAXC);
let ema2 = new StaticArray<f64>(MAXC);
function emaInto(out: StaticArray<f64>, p: i32): void {
  let k: f64 = 2.0 / (<f64>p + 1.0); let prev: f64 = 0; let seeded = false;
  for (let i = 0; i < nC; i++) {
    if (!seeded) {
      if (i == p - 1) { let s: f64 = 0; for (let j = 0; j < p; j++) s += cClose[j]; prev = s / (<f64>p); out[i] = prev; seeded = true; }
      else out[i] = NaN;
    } else { prev = cClose[i] * k + prev * (1.0 - k); out[i] = prev; }
  }
}
export function computeMacd(fast: i32, slow: i32, signal: i32): void {
  emaInto(ema1, fast); emaInto(ema2, slow);
  for (let i = 0; i < nC; i++) macdVal[i] = (isNaN(ema1[i]) || isNaN(ema2[i])) ? NaN : ema1[i] - ema2[i];
  let k: f64 = 2.0 / (<f64>signal + 1.0); let prev: f64 = 0; let seeded = false; let cnt = 0; let sum: f64 = 0;
  for (let i = 0; i < nC; i++) {
    if (isNaN(macdVal[i])) { macdSig[i] = NaN; macdHist[i] = NaN; continue; }
    if (!seeded) {
      sum += macdVal[i]; cnt++;
      if (cnt == signal) { prev = sum / (<f64>signal); macdSig[i] = prev; seeded = true; } else macdSig[i] = NaN;
    } else { prev = macdVal[i] * k + prev * (1.0 - k); macdSig[i] = prev; }
    macdHist[i] = isNaN(macdSig[i]) ? NaN : macdVal[i] - macdSig[i];
  }
}
export function macdAt(i: i32): f64 { return macdVal[i]; }
export function macdSigAt(i: i32): f64 { return macdSig[i]; }
export function macdHistAt(i: i32): f64 { return macdHist[i]; }
export function macdAbsMax(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; let m: f64 = 0;
  for (let i = s; i < nC; i++) {
    let a = macdVal[i]; if (!isNaN(a) && NativeMath.abs(a) > m) m = NativeMath.abs(a);
    let h = macdHist[i]; if (!isNaN(h) && NativeMath.abs(h) > m) m = NativeMath.abs(h);
    let g = macdSig[i]; if (!isNaN(g) && NativeMath.abs(g) > m) m = NativeMath.abs(g);
  }
  return m;
}

// ── VWAP (anchored cumulative, typical price H+L+C/3) ──
let vwapV = new StaticArray<f64>(MAXC);
export function computeVwap(): void {
  let pv: f64 = 0, vv: f64 = 0;
  for (let i = 0; i < nC; i++) {
    let tp = (cHigh[i] + cLow[i] + cClose[i]) / 3.0;
    pv += tp * cVol[i]; vv += cVol[i];
    vwapV[i] = vv > 0 ? pv / vv : NaN;
  }
}
export function vwapAt(i: i32): f64 { return vwapV[i]; }

// ── ATR (Average True Range, Wilder) ──
let atrV = new StaticArray<f64>(MAXC);
export function computeAtr(p: i32): void {
  if (nC == 0) return; atrV[0] = NaN;
  let sumTR: f64 = 0, prev: f64 = 0;
  for (let i = 1; i < nC; i++) {
    let tr = cHigh[i] - cLow[i];
    let hc = NativeMath.abs(cHigh[i] - cClose[i - 1]); if (hc > tr) tr = hc;
    let lc = NativeMath.abs(cLow[i] - cClose[i - 1]);  if (lc > tr) tr = lc;
    if (i <= p) { sumTR += tr; if (i == p) { prev = sumTR / (<f64>p); atrV[i] = prev; } else atrV[i] = NaN; }
    else { prev = (prev * (<f64>(p - 1)) + tr) / (<f64>p); atrV[i] = prev; }
  }
}
export function atrAt(i: i32): f64 { return atrV[i]; }
export function atrMax(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; let m: f64 = 0;
  for (let i = s; i < nC; i++) if (!isNaN(atrV[i]) && atrV[i] > m) m = atrV[i]; return m;
}

// ── KDJ (stochastic 9,3,3) ──
let kV = new StaticArray<f64>(MAXC);
let dV = new StaticArray<f64>(MAXC);
let jV = new StaticArray<f64>(MAXC);
export function computeKdj(n: i32): void {
  let K: f64 = 50, D: f64 = 50;
  for (let i = 0; i < nC; i++) {
    if (i < n - 1) { kV[i] = NaN; dV[i] = NaN; jV[i] = NaN; continue; }
    let hh = cHigh[i], ll = cLow[i];
    for (let j = i - n + 1; j <= i; j++) { if (cHigh[j] > hh) hh = cHigh[j]; if (cLow[j] < ll) ll = cLow[j]; }
    let rsv = hh > ll ? (cClose[i] - ll) / (hh - ll) * 100.0 : 0.0;
    K = (2.0 / 3.0) * K + (1.0 / 3.0) * rsv;
    D = (2.0 / 3.0) * D + (1.0 / 3.0) * K;
    kV[i] = K; dV[i] = D; jV[i] = 3.0 * K - 2.0 * D;
  }
}
export function kdjK(i: i32): f64 { return kV[i]; }
export function kdjD(i: i32): f64 { return dV[i]; }
export function kdjJ(i: i32): f64 { return jV[i]; }
export function kdjMin(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; let m: f64 = 1e9;
  for (let i = s; i < nC; i++) { if (!isNaN(jV[i]) && jV[i] < m) m = jV[i]; if (!isNaN(kV[i]) && kV[i] < m) m = kV[i]; }
  return m == 1e9 ? 0 : m;
}
export function kdjMax(n: i32): f64 {
  let s = nC - n; if (s < 0) s = 0; let m: f64 = -1e9;
  for (let i = s; i < nC; i++) { if (!isNaN(jV[i]) && jV[i] > m) m = jV[i]; if (!isNaN(kV[i]) && kV[i] > m) m = kV[i]; }
  return m == -1e9 ? 100 : m;
}

// ── microstructure: microprice = (Pa·Vb + Pb·Va)/(Va+Vb), leans toward the thinner side ──
export function microprice(): f64 {
  if (nBid == 0 || nAsk == 0) return 0;
  let pb = bidPrice[0], pa = askPrice[0], vb = bidVol[0], va = askVol[0];
  let t = vb + va;
  return t > 0 ? (pa * vb + pb * va) / t : (pa + pb) / 2.0;
}

// Walk the ask book to estimate fill VWAP + filled qty for a MARKET BUY of `amount` base.
export function marketBuyVwap(amount: f64): f64 {
  let remaining = amount, cost: f64 = 0, filled: f64 = 0;
  for (let k = 0; k < nAsk && remaining > 0; k++) {
    let take = remaining < askVol[k] ? remaining : askVol[k];
    cost += take * askPrice[k];
    filled += take;
    remaining -= take;
  }
  return filled > 0 ? cost / filled : 0;
}
