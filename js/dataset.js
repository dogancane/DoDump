/* ==========================================================================
 * dataset.js
 * Import and validation of measured stone data (Excel / CSV).
 *
 *   parseRows(rows)        rows = array of arrays (from SheetJS or CSV)
 *                          -> header guess and column candidates
 *   extract(rows, opts)    pull masses (and optional shape / dimension
 *                          columns) from the data block; record row numbers
 *   analyse(rec, opts)     validation and statistics:
 *        - missing / non-numeric / non-positive values in the data block
 *        - Tukey outliers on log(mass), 1.5 and 3 IQR fences
 *        - order breaks (sheet not sorted) and repeated values
 *        - number-weighted and mass-weighted percentiles, M50, Dn50, Mem
 *        - conformity with grade limits (% lighter than, by mass, fines added)
 *        - log-binned histograms (number and mass)
 * The batch test of the user is embedded in grades.js (BATCH).
 * ========================================================================== */
(function (FP) {
  'use strict';

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const toNum = (v) => {
    if (isNum(v)) return v;
    if (typeof v === 'string') { const t = v.trim().replace(',', '.'); if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t); }
    return null;
  };

  function parseCSV(text) {
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return text.split(/\r?\n/).map(line => line.split(sep).map(c => { const t = c.trim().replace(/^"|"$/g, ''); const n = toNum(t); return n == null ? (t === '' ? null : t) : n; }));
  }

  /** Guess header row and columns. */
  function parseRows(rows) {
    let header = -1, best = null;
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const row = rows[r] || [];
      const txt = row.map(c => typeof c === 'string' ? c.toLowerCase() : '');
      const mi = txt.findIndex(t => /mass|weight|kg|vekt|masse/.test(t));
      if (mi >= 0) { header = r; best = mi; break; }
    }
    const ncol = Math.max.apply(null, rows.slice(0, 300).map(r => (r || []).length).concat([0]));
    const cols = [];
    for (let c = 0; c < ncol; c++) {
      let num = 0, label = '';
      for (let r = 0; r < rows.length; r++) if (isNum(toNum((rows[r] || [])[c]))) num++;
      if (header >= 0) label = [rows[header], rows[header + 1]].map(rw => rw && rw[c] != null ? String(rw[c]) : '').filter(Boolean).join(' / ');
      cols.push({ c, label: label || 'Column ' + colName(c), numeric: num });
    }
    return { header, massCol: best, cols };
  }

  function colName(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }

  /**
   * opts: { massCol, idCol, shapeCol, dimCols: [L,B,T] or null, startRow, unit: 'kg'|'t' }
   * Data block: from startRow until the first row where neither the id nor the
   * mass column is numeric (summary rows such as TOTALS end the block).
   */
  function extract(rows, opts) {
    const rec = { masses: [], rows: [], ids: [], missing: [], nonPositive: [], ld: [], dims: [] };
    const f = opts.unit === 't' ? 1000 : 1;
    let started = false;
    for (let r = opts.startRow; r < rows.length; r++) {
      const row = rows[r] || [];
      const m = toNum(row[opts.massCol]);
      const id = opts.idCol != null ? toNum(row[opts.idCol]) : null;
      const anyId = opts.idCol != null ? id != null : false;
      if (m == null && !anyId) { if (started) break; else continue; }
      started = true;
      const rowNo = r + 1;
      if (m == null) { rec.missing.push({ row: rowNo, id, raw: row[opts.massCol] }); continue; }
      if (m <= 0) { rec.nonPositive.push({ row: rowNo, id, value: m }); continue; }
      rec.masses.push(m * f); rec.rows.push(rowNo); rec.ids.push(id != null ? id : rec.masses.length);
      if (opts.shapeCol != null) { const v = toNum(row[opts.shapeCol]); if (v != null) rec.ld.push([id != null ? id : rec.masses.length, v]); }
      if (opts.dimCols) {
        const d = opts.dimCols.map(c => toNum(row[c]));
        if (d.every(v => v != null && v > 0)) rec.dims.push({ id, m: m * f, L: d[0], B: d[1], T: d[2] });
      }
    }
    return rec;
  }

  function pct(s, q) { const k = (s.length - 1) * q, f = Math.floor(k), c = Math.min(f + 1, s.length - 1); return s[f] + (s[c] - s[f]) * (k - f); }
  function mpct(s, q) { const T = s.reduce((a, b) => a + b, 0); let acc = 0; for (const v of s) { acc += v; if (acc >= q * T) return v; } return s[s.length - 1]; }

  /** rec: {masses, rows, ids, missing, nonPositive, ld, fines}; opts: {rho, grade} */
  function analyse(rec, opts) {
    const m = rec.masses, n = m.length;
    const s = m.slice().sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    const out = { n, sum, min: s[0], max: s[n - 1], mean: sum / n, rho: opts.rho };
    out.missing = rec.missing || []; out.nonPositive = rec.nonPositive || [];
    // order breaks and repeats
    out.orderBreaks = [];
    for (let i = 1; i < n; i++) if (m[i] < m[i - 1]) out.orderBreaks.push({ row: rec.rows[i], id: rec.ids[i], prev: m[i - 1], value: m[i] });
    out.repeats = n - new Set(m).size;
    // Tukey on log mass
    const lm = s.map(Math.log);
    const q1 = pct(lm, 0.25), q3 = pct(lm, 0.75), iqr = q3 - q1;
    out.fences = { inner: [Math.exp(q1 - 1.5 * iqr), Math.exp(q3 + 1.5 * iqr)], outer: [Math.exp(q1 - 3 * iqr), Math.exp(q3 + 3 * iqr)] };
    out.outliers = [];
    m.forEach((v, i) => {
      if (v < out.fences.inner[0] || v > out.fences.inner[1]) out.outliers.push({ row: rec.rows[i], id: rec.ids[i], value: v, far: v < out.fences.outer[0] || v > out.fences.outer[1] });
    });
    // percentiles
    out.num = {}; out.mass = {};
    [0.1, 0.15, 0.5, 0.85, 0.9].forEach(q => { out.num[q] = pct(s, q); out.mass[q] = mpct(s, q); });
    const rho = opts.rho;
    const Dn = (x) => Math.cbrt(x / rho) * 1000;
    out.M50 = out.mass[0.5]; out.Dn50 = Dn(out.M50); out.medianNum = out.num[0.5];
    out.Dn = { min: Dn(out.min), max: Dn(out.max), d15: Dn(out.mass[0.15]), d85: Dn(out.mass[0.85]) };
    out.D85D15 = out.Dn.d85 / out.Dn.d15;
    out.fines = rec.fines || 0;
    out.Mt = sum + out.fines;
    out.Mem = (out.Mt - out.fines) / n;
    // conformity with grade limits
    out.conformity = [];
    const g = opts.grade;
    if (g && g.limits) {
      g.limits.forEach(L => {
        const below = s.filter(v => v < L.mass).reduce((a, b) => a + b, 0) + out.fines;
        const pc = below / out.Mt * 100;
        out.conformity.push({ name: L.name, mass: L.mass, pct: pc, req: L.pass, ok: pc >= L.pass[0] - 1e-9 && pc <= L.pass[1] + 1e-9 });
      });
      if (g.Mem) out.conformity.push({ name: 'Mem', mass: null, pct: out.Mem, req: g.Mem, ok: out.Mem >= g.Mem[0] && out.Mem <= g.Mem[1], unit: 'kg' });
    }
    // histograms in log mass
    const NB = 14, l0 = Math.log(s[0]) - 1e-9, l1 = Math.log(s[n - 1]) + 1e-9;
    out.bins = [];
    for (let k = 0; k < NB; k++) out.bins.push({ lo: Math.exp(l0 + (l1 - l0) * k / NB), hi: Math.exp(l0 + (l1 - l0) * (k + 1) / NB), n: 0, m: 0 });
    s.forEach(v => { const k = Math.min(NB - 1, Math.floor((Math.log(v) - l0) / (l1 - l0) * NB)); out.bins[k].n++; out.bins[k].m += v; });
    out.bins.forEach(b => { b.fn = b.n / n; b.fm = b.m / sum; });
    // cumulative curves
    let cn = 0, cm = 0;
    out.cdf = s.map(v => { cn++; cm += v; return { m: v, pn: cn / n, pm: cm / sum }; });
    // shape records
    out.ld = rec.ld || [];
    return out;
  }

  FP.dataset = { parseCSV, parseRows, extract, analyse, colName, toNum };
})(self.FP = self.FP || {});
