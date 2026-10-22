/* ==========================================================================
 * ui-pages.js
 * Page builders: Grades & data (library, measured data, Excel import),
 * Fall pipe string (stacks, buckets, materials), Probability & parametric,
 * System (future coupled modules).
 * ========================================================================== */
(function (FP) {
  'use strict';
  const U = FP.ui;
  const { $, $$, esc, fx } = U;
  const SRC_LABEL = { datasheet: 'datasheet', standard: 'standard', definition: 'by definition', typical: 'typical, verify', assumption: 'assumption' };

  /* =====================================================================
   * GRADES & DATA
   * ===================================================================== */
  let selGrade = null, imp = null;

  function renderGrades() {
    const lib = U.library;
    if (!selGrade || !lib.find(g => g.id === selGrade)) selGrade = U.cfg.grade.id;
    const g = lib.find(x => x.id === selGrade) || lib[0];
    $('#gradeList').innerHTML = lib.map(x => '<button type="button" class="glist' + (x.id === g.id ? ' on' : '') + '" data-gsel="' + esc(x.id) + '"><b>' + esc(x.name) + '</b><span>' + esc(x.family) + (x.measured && x.family !== 'measured' ? ', measured' : '') + (x.id === U.cfg.grade.id ? ', in use' : '') + '</span></button>').join('') +
      '<div class="btnrow"><button type="button" class="btn sm ghost" id="gNew">New D-value grade</button><button type="button" class="btn sm ghost" id="gDup">Duplicate</button><button type="button" class="btn sm ghost" id="gDel">Delete</button><button type="button" class="btn sm ghost" id="gRestore">Restore library</button></div>';
    renderGradeDetail(g);
    renderImport();
  }

  function limitsTable(g) {
    if (g.kind === 'mass') {
      return '<div class="tbl-wrap"><table class="data"><thead><tr><th>Limit</th><th>Mass [kg]</th><th>Dn [mm]</th><th>Max. expected length [mm]</th><th>Ds [mm]</th><th>% lighter by mass</th><th>Source</th></tr></thead><tbody>' +
        g.limits.map(l => '<tr><td>' + l.name + '</td><td>' + l.mass + '</td><td>' + (l.Dn != null ? l.Dn : '<span class="muted">' + fx(Math.cbrt(l.mass / g.rho) * 1000, 0) + ' (derived)</span>') + '</td><td>' + (l.Lmax != null ? l.Lmax : 'not given') + '</td><td>' + (l.Ds != null ? l.Ds : 'not given') + '</td><td>' + l.pass[0] + ' to ' + l.pass[1] + '</td><td>' + esc(l.src) + '</td></tr>').join('') + '</tbody></table></div>';
    }
    if (g.kind === 'sieve') {
      return '<div class="tbl-wrap"><table class="data"><thead><tr><th>Sieve [mm]</th><th>% passing by mass</th></tr></thead><tbody>' +
        g.sieves.map(s => '<tr><td>' + s.size + '</td><td>' + s.pass[0] + ' to ' + s.pass[1] + '</td></tr>').join('') + '</tbody></table></div><p class="note">' + esc(g.sieveSrc) + '</p>';
    }
    if (g.dvals) { const D = g.dvals; return '<p class="note">D-values (Dn, mm): Dmin ' + D.dMin + ', D10 ' + D.d10 + ', D50 ' + D.d50 + ', D90 ' + D.d90 + ', Dmax ' + D.dMax + ' (' + D.basis + ' basis)</p>'; }
    return '';
  }

  const EDIT = [
    ['name', 'Name', 'text'], ['revision', 'Revision', 'text'], ['rho', 'Density [kg/m3]', 'num'], ['bulkDensity', 'Bulk density [kg/m3]', 'num'],
    ['LmaxRatio', 'Lmax / Dn', 'num'], ['source', 'Source note', 'text'], ['notes', 'Notes', 'text'],
    ['shape.LTmean', 'Shape L/T mean', 'num'], ['shape.LTsd', 'Shape L/T SD', 'num'], ['shape.LTmin', 'Shape L/T min', 'num'], ['shape.LTmax', 'Shape L/T max', 'num'],
    ['shape.phi', 'Shape phi (B = T (L/T)^phi)', 'num'], ['shape.irregular', 'Irregularity', 'num'], ['shape.src', 'Shape source', 'text']
  ];

  function renderGradeDetail(g) {
    const rows = FP.grades.summaryRows(g);
    let html = '<div class="sumhead"><h3>' + esc(g.name) + '</h3><button type="button" class="btn sm" id="gUse">Use in simulation</button></div>' +
      (g.notes ? '<p class="note">' + esc(g.notes) + '</p>' : '') +
      '<dl class="kv wide">' + rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' +
      '<h4>Limits</h4>' + limitsTable(g);
    // sampler curve
    let smp = null;
    try { smp = FP.grades.sampler(g, { dnPerD: U.cfg.shape.dnPerD }); } catch (e) { smp = null; }
    html += '<h4>Distribution used for stone generation</h4><p class="note">' + esc(smp ? smp.label : 'not available') + '</p><div class="chartpair"><canvas class="chart tall" id="gCdf"></canvas><canvas class="chart tall" id="gHist"></canvas></div>';
    if (g.measured) html += '<h4>Measured data: ' + esc(g.measured.file || 'import') + '</h4><div id="gMeasured"></div>';
    const fields = EDIT.concat(g.dvals ? [['dvals.dMin', 'Dmin (Dn) [mm]', 'num'], ['dvals.d10', 'D10 [mm]', 'num'], ['dvals.d50', 'D50 [mm]', 'num'], ['dvals.d90', 'D90 [mm]', 'num'], ['dvals.dMax', 'Dmax [mm]', 'num'], ['dvals.basis', 'Basis (mass / number)', 'text']] : []);
    html += '<h4>Edit grade fields</h4><div class="editgrid">' + fields.map(f => {
      const v = U.getP(g, f[0]);
      return '<label class="row"><span class="lab">' + esc(f[1]) + '</span><span class="ctl"><input type="' + (f[2] === 'num' ? 'number' : 'text') + '" step="any" id="ge-' + f[0].replace(/\./g, '-') + '" data-gk="' + f[0] + '" value="' + esc(v == null ? '' : v) + '"></span></label>';
    }).join('') + '</div><p class="note">Empty numeric fields mean "not given". Changes apply to the library copy immediately; use "Use in simulation" to load the grade.</p>';
    $('#gradeDetail').innerHTML = html;
    drawGradeCharts(g, smp);
    if (g.measured) renderMeasured(g, '#gMeasured');
  }

  function drawGradeCharts(g, smp) {
    if (!smp) return;
    const r = FP.particles.rng(99), ms = [];
    for (let i = 0; i < 3000; i++) ms.push(smp.sample(r));
    const s = ms.slice().sort((a, b) => a - b), T = s.reduce((a, b) => a + b, 0);
    let cm = 0;
    const ptsM = [], ptsN = [];
    s.forEach((v, i) => { cm += v; if (i % 15 === 0 || i === s.length - 1) { ptsM.push({ x: v, y: cm / T }); ptsN.push({ x: v, y: (i + 1) / s.length }); } });
    const curves = [{ pts: ptsM, color: '--c-out', label: 'generated, by mass' }, { pts: ptsN, color: '--c-in', label: 'generated, by number' }];
    if (g.measured) {
      const a = FP.dataset.analyse({ masses: g.measured.masses, rows: [], ids: [], fines: 0 }, { rho: g.rho });
      curves.push({ pts: a.cdf.map(p => ({ x: p.m, y: p.pm })), color: '--ink', label: 'measured, by mass', dash: true });
    }
    let markers = [];
    if (g.kind === 'mass') markers = g.limits.map(l => ({ x: l.mass, lo: l.pass[0], hi: l.pass[1], label: l.name }));
    else if (g.kind === 'sieve') { const rr = FP.grades.dnPerD(g) || U.cfg.shape.dnPerD; markers = g.sieves.map(sv => ({ x: FP.grades.massOfDn(sv.size / 1000 * rr, g.rho), lo: sv.pass[0], hi: sv.pass[1], label: String(sv.size) })); }
    FP.charts.cdf($('#gCdf'), curves, markers, { xUnit: 'stone mass, kg' });
    const NB = 14, l0 = Math.log(s[0]) - 1e-9, l1 = Math.log(s[s.length - 1]) + 1e-9, bins = [];
    for (let k = 0; k < NB; k++) bins.push({ lo: Math.exp(l0 + (l1 - l0) * k / NB), hi: Math.exp(l0 + (l1 - l0) * (k + 1) / NB), n: 0, m: 0 });
    s.forEach(v => { const k = Math.min(NB - 1, Math.floor((Math.log(v) - l0) / (l1 - l0) * NB)); bins[k].n++; bins[k].m += v; });
    bins.forEach(b => { b.fn = b.n / s.length; b.fm = b.m / T; });
    FP.charts.hist($('#gHist'), bins, { xUnit: 'generated stones, kg' });
  }

  function renderMeasured(g, sel, recOverride) {
    const M = g.measured;
    const rec = recOverride || { masses: M.masses, rows: M.rows || M.masses.map((_, i) => i + 1), ids: M.ids || M.masses.map((_, i) => i + 1), missing: M.missing || [], nonPositive: M.nonPositive || [], ld: M.ld || [], fines: M.fines || 0 };
    const base = g.limits ? g : U.library.find(x => x.id === 'lma40-200');
    const a = FP.dataset.analyse(rec, { rho: g.rho, grade: base });
    const el = $(sel); if (!el) return;
    el.innerHTML = analysisHTML(a, M, base) + '<div class="chartpair"><canvas class="chart tall" id="' + sel.slice(1) + '-h"></canvas><canvas class="chart tall" id="' + sel.slice(1) + '-c"></canvas></div>';
    FP.charts.hist($(sel + '-h'), a.bins, { xUnit: 'measured stones, kg' });
    FP.charts.cdf($(sel + '-c'), [{ pts: a.cdf.map(p => ({ x: p.m, y: p.pn })), color: '--c-in', label: 'by number' }, { pts: a.cdf.map(p => ({ x: p.m, y: p.pm })), color: '--c-out', label: 'by mass (fines excl.)' }],
      base && base.limits ? base.limits.map(l => ({ x: l.mass, lo: l.pass[0], hi: l.pass[1], label: l.name })) : [], { xUnit: 'stone mass, kg' });
  }
  U.renderMeasured = renderMeasured;

  function analysisHTML(a, M, base) {
    const q = [0.1, 0.15, 0.5, 0.85, 0.9];
    const val = [
      ['Stones with a valid mass', a.n],
      ['Missing or non-numeric masses in the data block', a.missing.length ? a.missing.map(m => 'row ' + m.row).join(', ') : 'none'],
      ['Zero or negative masses', a.nonPositive.length ? a.nonPositive.map(m => 'row ' + m.row + ' (' + m.value + ')').join(', ') : 'none'],
      ['Outliers (Tukey, log mass, 1.5 IQR: ' + fx(a.fences.inner[0], 1) + ' to ' + fx(a.fences.inner[1], 1) + ' kg)', a.outliers.length ? a.outliers.map(o => 'row ' + o.row + ' ' + o.value + ' kg' + (o.far ? ' (far)' : '')).join(', ') : 'none'],
      ['Rows out of ascending order', a.orderBreaks.length ? a.orderBreaks.map(o => 'row ' + o.row + ' (stone ' + o.id + ', ' + o.value + ' kg after ' + o.prev + ' kg)').join(', ') : 'none'],
      ['Repeated mass values', a.repeats + ' (expected with 0.5 kg resolution)'],
      ['Fragments weighed in bulk', (a.fines || 0) + ' kg' + (M && M.finesNote ? ' (' + M.finesNote + ')' : '')],
      ['Shape records', a.ld.length ? a.ld.length + ' stones: ' + a.ld.map(r => '#' + r[0] + ' ' + r[1]).join(', ') + (M && M.ldNote ? '. ' + M.ldNote : '') : 'none'],
      ['Dimensions (L, B, T)', M && M.dims && M.dims.length ? M.dims.length + ' stones' : 'not available: Dn is the equivalent cube size from mass and density; it is not a measured length']
    ];
    const stat = [
      ['Total mass of weighed stones / Mt incl. fragments', fx(a.sum, 1) + ' / ' + fx(a.Mt, 1) + ' kg'],
      ['Min / mean / max mass', fx(a.min, 1) + ' / ' + fx(a.mean, 1) + ' / ' + fx(a.max, 1) + ' kg'],
      ['Mem = (Mt - fragments) / n', fx(a.Mem, 2) + ' kg'],
      ['Number-weighted M10 / M50 / M90', q.filter(x => x !== 0.15 && x !== 0.85).map(x => fx(a.num[x], 1)).join(' / ') + ' kg'],
      ['Mass-weighted M10 / M50 / M90', q.filter(x => x !== 0.15 && x !== 0.85).map(x => fx(a.mass[x], 1)).join(' / ') + ' kg'],
      ['Dn50 (from mass-weighted M50, rho ' + a.rho + ')', fx(a.Dn50, 0) + ' mm (equivalent cube, derived)'],
      ['Dn range', fx(a.Dn.min, 0) + ' to ' + fx(a.Dn.max, 0) + ' mm'],
      ['Dn85 / Dn15 (by mass)', fx(a.D85D15, 2)]
    ];
    const conf = a.conformity.length ? '<div class="tbl-wrap"><table class="data"><thead><tr><th>Check vs ' + esc(base.name) + '</th><th>Value</th><th>Requirement</th><th></th></tr></thead><tbody>' +
      a.conformity.map(c => '<tr><td>' + (c.unit ? 'Mem' : '% lighter than ' + c.name + ' (' + c.mass + ' kg)') + '</td><td>' + fx(c.pct, 2) + (c.unit ? ' kg' : ' %') + '</td><td>' + c.req[0] + ' to ' + c.req[1] + (c.unit ? ' kg' : ' %') + '</td><td>' + (c.ok ? '<span class="tag st0">within</span>' : '<span class="tag st3">outside</span>') + '</td></tr>').join('') + '</tbody></table></div><p class="note">Percentages by mass of Mt, fragments counted as lighter than every limit.</p>' : '';
    return '<div class="cols2"><dl class="kv">' + val.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl><dl class="kv">' + stat.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl></div>' + conf;
  }

  /* ---------- Excel / CSV import ---------- */
  function loadXLSX() {
    return new Promise((res, rej) => {
      if (window.XLSX) return res(window.XLSX);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('The Excel reader could not be loaded. Save the sheet as CSV and import that instead.'));
      document.head.appendChild(s);
    });
  }

  function renderImport() {
    const el = $('#importBody');
    if (!imp) { el.innerHTML = '<p class="note">Choose an .xlsx, .xls or .csv file with one row per weighed stone. The file is read in your browser only.</p>'; return; }
    const colOpts = (sel, allowNone) => (allowNone ? '<option value="">none</option>' : '') + imp.parsed.cols.map(c => '<option value="' + c.c + '"' + (String(sel) === String(c.c) ? ' selected' : '') + '>' + FP.dataset.colName(c.c) + ': ' + esc(c.label) + ' (' + c.numeric + ' numbers)</option>').join('');
    el.innerHTML = '<p class="note">' + esc(imp.file) + (imp.sheets ? ', sheet ' : '') + (imp.sheets ? '<select id="impSheet">' + imp.sheets.map(s => '<option' + (s === imp.sheet ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' : '') + '</p>' +
      '<div class="editgrid">' +
      '<label class="row"><span class="lab">Mass column</span><span class="ctl"><select id="impMass">' + colOpts(imp.opts.massCol) + '</select></span></label>' +
      '<label class="row"><span class="lab">Stone number column</span><span class="ctl"><select id="impId">' + colOpts(imp.opts.idCol, true) + '</select></span></label>' +
      '<label class="row"><span class="lab">Shape (L/T or l/d) column</span><span class="ctl"><select id="impShape">' + colOpts(imp.opts.shapeCol, true) + '</select></span></label>' +
      '<label class="row"><span class="lab">L / B / T columns [mm]</span><span class="ctl"><select id="impL">' + colOpts(imp.opts.dimCols ? imp.opts.dimCols[0] : '', true) + '</select><select id="impB">' + colOpts(imp.opts.dimCols ? imp.opts.dimCols[1] : '', true) + '</select><select id="impT">' + colOpts(imp.opts.dimCols ? imp.opts.dimCols[2] : '', true) + '</select></span></label>' +
      '<label class="row"><span class="lab">First data row (Excel row number)</span><span class="ctl"><input type="number" id="impStart" value="' + (imp.opts.startRow + 1) + '"></span></label>' +
      '<label class="row"><span class="lab">Mass unit</span><span class="ctl"><select id="impUnit"><option value="kg"' + (imp.opts.unit === 'kg' ? ' selected' : '') + '>kg</option><option value="t"' + (imp.opts.unit === 't' ? ' selected' : '') + '>t</option></select></span></label>' +
      '<label class="row"><span class="lab">Fragments weighed in bulk [kg]</span><span class="ctl"><input type="number" step="any" id="impFines" value="' + (imp.fines || 0) + '"></span></label>' +
      '<label class="row"><span class="lab">Compare with grade limits of</span><span class="ctl"><select id="impBase">' + U.library.filter(g => g.limits).map(g => '<option value="' + g.id + '"' + (g.id === imp.baseId ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select></span></label>' +
      '<label class="row"><span class="lab">Rock density [kg/m3]</span><span class="ctl"><input type="number" step="any" id="impRho" value="' + imp.rho + '"></span></label>' +
      '</div><div class="btnrow"><button type="button" class="btn sm" id="impRun">Validate and analyse</button></div><div id="impResult"></div>';
    if (imp.rec) showImportResult();
  }

  function readImportOpts() {
    const v = (id) => { const x = $(id).value; return x === '' ? null : +x; };
    imp.opts.massCol = v('#impMass'); imp.opts.idCol = v('#impId'); imp.opts.shapeCol = v('#impShape');
    const L = v('#impL'), B = v('#impB'), T = v('#impT');
    imp.opts.dimCols = L != null && B != null && T != null ? [L, B, T] : null;
    imp.opts.startRow = Math.max(0, (parseInt($('#impStart').value, 10) || 1) - 1);
    imp.opts.unit = $('#impUnit').value;
    imp.fines = parseFloat($('#impFines').value) || 0;
    imp.baseId = $('#impBase').value; imp.rho = parseFloat($('#impRho').value) || 2650;
  }

  function showImportResult() {
    const base = U.library.find(g => g.id === imp.baseId);
    const rec = Object.assign({}, imp.rec, { fines: imp.fines });
    const fake = { rho: imp.rho, limits: base.limits, Mem: base.Mem, name: base.name, measured: { file: imp.file, masses: rec.masses, finesNote: 'entered at import', ldNote: '' } };
    $('#impResult').innerHTML = '<div id="impAn"></div><div class="btnrow"><label class="row" style="flex:1"><span class="lab">New grade name</span><span class="ctl"><input type="text" id="impName" value="' + esc(base.name + ' (' + imp.file.replace(/\.[^.]+$/, '') + ')') + '"></span></label><button type="button" class="btn sm" id="impSave">Save as measured grade</button></div>';
    U.renderMeasured(Object.assign({}, base, fake), '#impAn', rec);
  }

  async function onFile(file) {
    const name = file.name;
    try {
      let rows, sheets = null, sheet = null, wb = null;
      if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) rows = FP.dataset.parseCSV(await file.text());
      else {
        const X = await loadXLSX();
        wb = X.read(await file.arrayBuffer(), { type: 'array' });
        sheets = wb.SheetNames; sheet = sheets[0];
        rows = sheetRows(X, wb.Sheets[sheet]);
      }
      setImport(name, rows, sheets, sheet, wb);
    } catch (err) { $('#importBody').innerHTML = '<p class="msg err">' + esc(err.message) + '</p>'; }
  }
  function sheetRows(X, ws) {
    const rg = X.utils.decode_range(ws['!ref'] || 'A1');
    return X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: { r: 0, c: 0 }, e: rg.e } });
  }
  function setImport(name, rows, sheets, sheet, wb) {
    const parsed = FP.dataset.parseRows(rows);
    const idCol = parsed.cols.find(c => /stone|no\.?|nr|id/i.test(c.label) && c.numeric > 5);
    const shapeCol = parsed.cols.find(c => /shape|l\/d|lt|l\/t/i.test(c.label));
    let start = parsed.header >= 0 ? parsed.header + 1 : 0;
    imp = { file: name, rows, parsed, sheets, sheet, wb, rho: U.cfg.grade.rho || 2650, fines: 0, baseId: 'lma40-200',
      opts: { massCol: parsed.massCol != null ? parsed.massCol : (parsed.cols.find(c => c.numeric > 5) || { c: 0 }).c, idCol: idCol ? idCol.c : null, shapeCol: shapeCol ? shapeCol.c : null, dimCols: null, startRow: start, unit: 'kg' } };
    // fragments: look for a "<15 kg (Mf)" style row with a number
    rows.forEach(r => { if (r && r.some(c => typeof c === 'string' && /mf\)|fragment|fines/i.test(c))) { const n = r.find(c => typeof c === 'number'); if (n != null && !imp.finesSet) { imp.fines = n; imp.finesSet = true; } } });
    renderImport();
  }

  /* =====================================================================
   * FALL PIPE STRING
   * ===================================================================== */
  let selStack = 1;
  /** Side view of the string shape (tilt / current / ROV) with joint table. */
  function shapeCard(cfg, str) {
    const sh = FP.catenary.solve(cfg, str), Lk = sh.links;
    if (!Lk.length) return '';
    const head = '<section class="card"><h3>Pipe shape</h3>';
    if (sh.mode === 'vertical') return head + '<p class="note">Pipe set vertical. Choose a tilt or the current-driven shape under Simulate, Pipe tilt, current and ROV.</p></section>';
    const W = 520, H = 440, padL = 70, padR = 150, padT = 20, padB = 50;
    const depth = Lk[Lk.length - 1].y1 || 1, dryV = cfg.physics.fluid ? (cfg.pipe.dryLen || 0) / 1000 : 0;
    const xs = Lk.map(l => l.x1).concat([0]), xMax = Math.max(0.05, Math.max.apply(null, xs.map(Math.abs)));
    const sy = (H - padT - padB) / depth, cx = padL + (W - padL - padR) / 2;
    const ex = Math.max(1, Math.min(50, Math.round(((W - padL - padR) / 2 * 0.8) / (xMax * sy))));
    const X = (x) => cx + x * sy * ex, Y = (y) => padT + y * sy;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:640px;height:auto;font:11px var(--font-mono);color:var(--ink)">';
    // water level and vertical reference
    svg += '<line x1="' + padL + '" x2="' + (W - padR + 40) + '" y1="' + Y(dryV) + '" y2="' + Y(dryV) + '" stroke="#2a8bd6" stroke-dasharray="6 4"/><text x="' + (W - padR + 44) + '" y="' + (Y(dryV) + 4) + '" fill="#2a8bd6">water level</text>';
    svg += '<line x1="' + cx + '" x2="' + cx + '" y1="' + Y(0) + '" y2="' + Y(depth) + '" stroke="var(--muted)" stroke-dasharray="2 4"/>';
    // current profile arrows
    if (sh.mode === 'current') {
      const S2 = cfg.pipe.shape, Umax = Math.max(0.05, Math.abs(S2.U0 - S2.vVessel), Math.abs(S2.U0));
      for (let k = 0; k <= 6; k++) {
        const z = dryV + (depth - dryV) * k / 6, U = FP.catenary.currentAt(S2, z - dryV) - S2.vVessel, len = 45 * U / Umax;
        const y = Y(z), x0 = 14;
        if (Math.abs(len) > 1) svg += '<line x1="' + x0 + '" x2="' + (x0 + len) + '" y1="' + y + '" y2="' + y + '" stroke="var(--accent)" stroke-width="1.5"/><path d="M' + (x0 + len) + ' ' + y + ' l' + (len > 0 ? -6 : 6) + ' -3 v6 z" fill="var(--accent)"/>';
      }
      svg += '<text x="4" y="' + (Y(dryV) - 6) + '" fill="var(--accent)">current (rel.)</text>';
    }
    // string
    svg += '<polyline fill="none" stroke="var(--ink)" stroke-width="3" points="' + [[0, 0]].concat(Lk.map(l => [l.x1, l.y1])).map(p => X(p[0]) + ',' + Y(p[1])).join(' ') + '"/>';
    Lk.forEach(l => { svg += '<circle cx="' + X(l.x1) + '" cy="' + Y(l.y1) + '" r="2.5" fill="var(--ink)"/>'; });
    const last = Lk[Lk.length - 1];
    if (sh.mode === 'current') svg += '<rect x="' + (X(last.x1) - 14) + '" y="' + (Y(last.y1)) + '" width="28" height="14" fill="var(--accent)" opacity="0.8"/><text x="' + (X(last.x1) + 18) + '" y="' + (Y(last.y1) + 11) + '">' + (sh.rovOn ? 'FP ROV' : 'bottom weight') + '</text>';
    // labels
    svg += '<text x="' + (X(0) + 6) + '" y="' + (Y(0) + 12) + '">top ' + fx(sh.topAngle, 1) + '\u00b0</text>';
    svg += '<text x="' + (X(last.x1) + 6) + '" y="' + (Y(last.y1) - 6) + '">bottom ' + fx(sh.bottomAngle, 1) + '\u00b0, offset ' + fx(sh.offset, 2) + ' m</text>';
    svg += '<text x="' + padL + '" y="' + (H - 8) + '" fill="var(--muted)">horizontal scale x' + ex + ' (vertical true scale, ' + fx(depth, 1) + ' m)</text></svg>';
    const tiles = [['Top / bottom angle', fx(sh.topAngle, 1) + ' / ' + fx(sh.bottomAngle, 1) + '\u00b0'], ['Tip offset', fx(sh.offset, 2) + ' m'], ['Max bow', fx(sh.maxBow, 2) + ' m']];
    if (sh.mode === 'current' && !sh.slack) {
      tiles.push(['Drag string / ROV', fx(sh.dragPipe / 1000, 1) + ' / ' + fx(sh.Fd / 1000, 1) + ' kN']);
      if (sh.rovOn) tiles.push(['ROV thrust needed', fx(Math.abs(sh.thrust) / 1000, 1) + ' / ' + fx(sh.thrustMax / 1000, 0) + ' kN']);
      tiles.push(['Top tension', fx(sh.Ttop / 1000, 0) + ' kN']);
    }
    const lim = cfg.pipe.shape.topLimit;
    const msgs = sh.warnings.slice();
    if (Math.abs(sh.topAngle) > lim) msgs.push('Top angle exceeds the allowed ' + lim + '\u00b0 in the moonpool.');
    const rows = Lk.map((l, i) => { const j = sh.joints[i]; return '<tr class="' + (j && j.over ? 'bad' : '') + '"><td>' + l.gi + '</td><td>' + fx(l.y1, 2) + '</td><td>' + fx(l.x1, 2) + '</td><td>' + fx(l.theta * 180 / Math.PI, 2) + '</td><td>' + (j ? fx(j.angle, 2) + ' / ' + fx(j.limit, 1) : '-') + '</td><td>' + (l.T != null ? fx(l.T / 1000, 1) : '-') + '</td><td>' + (l.f != null ? fx(l.f, 0) : '-') + '</td></tr>'; }).join('');
    return head + '<div class="tiles">' + tiles.map(t => '<div><em>' + t[0] + '</em><b>' + t[1] + '</b></div>').join('') + '</div>' +
      msgs.map(m => '<p class="msg warn">' + esc(m) + '</p>').join('') + svg +
      '<div class="tbl-wrap"><table class="data"><thead><tr><th>Bucket</th><th>Depth of lip [m]</th><th>Offset [m]</th><th>Angle [\u00b0]</th><th>Joint angle / limit [\u00b0]</th><th>Tension [kN]</th><th>Drag [N/m]</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">Static articulated chain (one rigid link per bucket). Angles from vertical, positive downstream. Joint limit tan = 2 c / ins. The DEM uses these angles by rotating gravity in the simulated section.</p></section>';
  }

  function renderString() {
    const cfg = U.cfg, S = cfg.pipe.string, mats = cfg.materials;
    const rhoW = cfg.physics.fluid ? cfg.physics.rhoF : 1025;
    let str = null, err = null;
    const v = FP.units.validate(cfg);
    try { str = FP.string.build(cfg, mats, rhoW, cfg.physics.g); } catch (e) { err = e.message; }
    const matOpt = (sel) => mats.map(m => '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('');
    const typeOpt = (sel, blank) => (blank ? '<option value="">default</option>' : '') + S.types.map(t => '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.id + ' ' + t.name) + '</option>').join('');
    const nS = Math.max(1, Math.min(30, S.nStacks | 0));
    if (selStack > nS) selStack = 1;
    let html = '';
    html += '<section class="card"><h3>String layout</h3><div class="editgrid">' +
      numIn('Number of stacks (1-30)', 'pipe.string.nStacks', S.nStacks, 'int') +
      numIn('Buckets per stack (default, 1-19)', 'pipe.string.bucketsPerStack', S.bucketsPerStack, 'int') +
      numIn('Insertion at stack joints [mm] (empty = bucket value)', 'pipe.string.jointIns', S.jointIns, 'numOrNull') +
      '<label class="row check"><input type="checkbox" data-sk="pipe.string.window.auto"' + (S.window.auto ? ' checked' : '') + '><span>DEM window centred on the narrowest transition</span></label>' +
      numIn('DEM window first bucket', 'pipe.string.window.start', S.window.start, 'int') +
      numIn('Buckets in DEM window', 'pipe.string.window.count', S.window.count, 'int') +
      '</div>' + (v.errors.length ? v.errors.map(m => '<p class="msg err">' + esc(m) + '</p>').join('') : '') + '</section>';

    // stacks
    html += '<section class="card"><h3>Stacks</h3><div class="tbl-wrap"><table class="data edit"><thead><tr><th>Stack</th><th>Buckets (empty = ' + S.bucketsPerStack + ')</th><th>Bucket type</th></tr></thead><tbody>';
    for (let i = 0; i < nS; i++) {
      const so = (S.stacks && S.stacks[i]) || {};
      html += '<tr><td>' + (i + 1) + '</td><td><input type="number" min="1" max="19" data-stack="' + i + '" data-sf="n" value="' + (so.n || '') + '"></td><td><select data-stack="' + i + '" data-sf="type">' + typeOpt(so.type || '', true) + '</select></td></tr>';
    }
    html += '</tbody></table></div></section>';

    // types
    html += '<section class="card"><h3>Bucket types</h3><div class="tbl-wrap"><table class="data edit"><thead><tr><th>Id</th><th>Name</th><th>Top ID [mm]</th><th>Bottom ID [mm]</th><th>Length [mm]</th><th>Wall [mm]</th><th>Insertion [mm]</th><th>Material</th><th></th></tr></thead><tbody>' +
      S.types.map((t, i) => '<tr><td>' + esc(t.id) + (t.id === S.defaultType ? ' (default)' : '') + '</td><td><input type="text" data-ti="' + i + '" data-tf="name" value="' + esc(t.name) + '"></td>' +
        ['dTop', 'dBot', 'h', 't', 'ins'].map(k => '<td><input type="number" step="any" data-ti="' + i + '" data-tf="' + k + '" value="' + t[k] + '"></td>').join('') +
        '<td><select data-ti="' + i + '" data-tf="mat">' + matOpt(t.mat) + '</select></td><td>' + (i > 0 ? '<button type="button" class="link danger" data-tdel="' + i + '">Remove</button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div><div class="btnrow"><button type="button" class="btn sm ghost" id="tAdd">Add bucket type</button></div></section>';

    // per-bucket overrides for selected stack
    if (str) {
      const inStack = str.buckets.filter(b => b.stack === selStack);
      html += '<section class="card"><h3>Individual buckets, stack <select id="stSel">' + Array.from({ length: nS }, (_, i) => '<option' + (i + 1 === selStack ? ' selected' : '') + '>' + (i + 1) + '</option>').join('') + '</select></h3>' +
        '<p class="note">Edit a value to override the bucket type for that bucket. Overridden cells are highlighted.</p><div class="tbl-wrap"><table class="data edit"><thead><tr><th>Bucket</th><th>Top ID</th><th>Bottom ID</th><th>Length</th><th>Wall</th><th>Insertion</th><th>Material</th><th></th></tr></thead><tbody>' +
        inStack.map(b => {
          const key = b.stack + '.' + b.idx, ov = S.overrides[key] || {};
          return '<tr><td>' + b.idx + '</td>' + ['dTop', 'dBot', 'h', 't', 'ins'].map(k => '<td><input type="number" step="any" class="' + (ov[k] != null ? 'ovr' : '') + '" data-ok="' + key + '" data-of="' + k + '" value="' + b[k] + '"></td>').join('') +
            '<td><select class="' + (ov.mat ? 'ovr' : '') + '" data-ok="' + key + '" data-of="mat">' + matOpt(b.mat) + '</select></td><td>' + (Object.keys(ov).length ? '<button type="button" class="link" data-oclr="' + key + '">Clear</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';

      // computed
      const w = FP.string.windowOf(cfg, str), T = str.totals;
      html += '<section class="card"><h3>Computed string properties</h3>' +
        '<div class="tiles"><div><em>Buckets / stacks</em><b>' + T.nBuckets + ' / ' + T.nStacks + '</b></div><div><em>String length</em><b>' + fx(T.length, 2) + ' m</b></div><div><em>Mass in air</em><b>' + fx(T.mass / 1000, 2) + ' t</b></div><div><em>Submerged weight</em><b>' + fx(T.Wsub / 1000, 1) + ' kN</b></div><div><em>Narrowest clear path</em><b>' + fx(T.minClear, 0) + ' mm</b></div><div><em>DEM window</em><b>' + w.start + ' to ' + w.end + '</b></div></div>' +
        (T.Wsub < 0 ? '<p class="msg warn">The string is buoyant in water (negative submerged weight). It hangs only from the ROV / bottom weight and the chains; set them under Pipe tilt, current and ROV.</p>' : '') +
        '<div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th>Stack.bucket</th><th>Depth top [m]</th><th>ID top/bot [mm]</th><th>Length [mm]</th><th>Wall [mm]</th><th>Insertion [mm]</th><th>Radial clearance [mm]</th><th>Clear path [mm]</th><th>Material</th><th>Mass [kg]</th><th>Subm. weight [N]</th><th>EA [MN]</th><th>EI [kNm2]</th><th>N allow [kN]</th></tr></thead><tbody>' +
        str.buckets.map(b => '<tr class="' + (b.gi >= w.start && b.gi <= w.end ? 'win' : '') + (b.overridden ? ' ovrrow' : '') + '"><td>' + b.gi + '</td><td>' + b.stack + '.' + b.idx + '</td><td>' + fx(b.sTop / 1000, 2) + '</td><td>' + b.dTop + ' / ' + b.dBot + '</td><td>' + b.h + '</td><td>' + b.t + '</td><td>' + (b.gi < T.nBuckets ? b.ins : '-') + '</td><td class="' + (b.clearance != null && b.clearance <= 0 ? 'bad' : '') + '">' + (b.clearance == null ? '-' : fx(b.clearance, 1)) + '</td><td>' + fx(b.clearPath, 0) + '</td><td>' + esc(b.matName) + '</td><td>' + fx(b.mass, 1) + '</td><td>' + fx(b.Wsub, 0) + '</td><td>' + fx(b.EA / 1e6, 1) + '</td><td>' + fx(b.EI / 1e3, 1) + '</td><td>' + fx(b.Nallow / 1e3, 0) + '</td></tr>').join('') +
        '</tbody></table></div><p class="note">Highlighted rows are simulated by the DEM. Clear path is the smallest internal diameter rock meets through the bucket and its transition. N allow = allowable stress x wall area, no safety factor.</p></section>';
      html += shapeCard(cfg, str);
    } else if (err) html += '<p class="msg err">' + esc(err) + '</p>';

    // materials
    html += '<section class="card"><h3>Materials</h3><div class="tbl-wrap"><table class="data edit"><thead><tr><th>Id</th><th>Name</th><th>Density [kg/m3]</th><th>E [GPa]</th><th>Poisson</th><th>Allowable/yield [MPa]</th><th>MRS [MPa]</th><th>Roughness [mm]</th><th>Friction vs rock</th><th>Restitution vs rock</th><th>Rolling res.</th><th></th></tr></thead><tbody>' +
      mats.map((m, i) => '<tr><td>' + esc(m.id) + '</td><td><input type="text" data-mi="' + i + '" data-mf="name" value="' + esc(m.name) + '"></td>' +
        [['rho', 1], ['E', 1e9], ['nu', 1], ['sAllow', 1e6], ['mrs', 1e6], ['rough', 1], ['mu', 1], ['e', 1], ['muRoll', 1]].map(f => '<td><input type="number" step="any" data-mi="' + i + '" data-mf="' + f[0] + '" data-ms="' + f[1] + '" value="' + (m[f[0]] == null ? '' : +(m[f[0]] / f[1]).toPrecision(6)) + '" title="' + esc(m.src && m.src[f[0]] ? SRC_LABEL[m.src[f[0]]] : 'user') + '"><span class="srct s-' + (m.src && m.src[f[0]] || 'user') + '">' + esc(m.src && m.src[f[0]] ? SRC_LABEL[m.src[f[0]]] : 'user') + '</span></td>').join('') +
        '<td>' + (FP.materials.DEFAULT_MATERIALS.some(d => d.id === m.id) ? '' : '<button type="button" class="link danger" data-mdel="' + i + '">Remove</button>') + '</td></tr>').join('') +
      '</tbody></table></div>' + mats.map(m => m.note ? '<p class="note"><b>' + esc(m.name) + ':</b> ' + esc(m.note) + '</p>' : '').join('') +
      '<div class="btnrow"><button type="button" class="btn sm ghost" id="mAdd">Add custom material</button><button type="button" class="btn sm ghost" id="mReset">Restore default materials</button></div>' +
      '<p class="note">Materials set bucket mass and submerged weight, EA, EI and allowable load, rock-wall friction, restitution and rolling resistance, and the wall contact stiffness (Hertz E* ratio, clipped). They are exported to the future structural and catenary modules.</p></section>';
    $('#stringBody').innerHTML = html;
  }
  function numIn(label, key, v, t) {
    return '<label class="row"><span class="lab">' + esc(label) + '</span><span class="ctl"><input type="number" step="any" data-sk="' + key + '" data-st="' + t + '" value="' + (v == null ? '' : v) + '"></span></label>';
  }

  function onStringInput(e) {
    const el = e.target, cfg = U.cfg, S = cfg.pipe.string;
    const num = (x) => { const v = parseFloat(x); return isFinite(v) ? v : null; };
    let rebuild = false;
    if (el.dataset.sk) {
      if (el.type === 'checkbox') U.setP(cfg, el.dataset.sk, el.checked);
      else {
        let v = el.dataset.st === 'int' ? parseInt(el.value, 10) : num(el.value);
        if (el.dataset.st === 'numOrNull' && el.value === '') v = null;
        else if (v == null || !isFinite(v)) return;
        U.setP(cfg, el.dataset.sk, v);
      }
      rebuild = true;
    } else if (el.dataset.stack != null) {
      const i = +el.dataset.stack; S.stacks = S.stacks || [];
      S.stacks[i] = S.stacks[i] || {};
      if (el.dataset.sf === 'n') S.stacks[i].n = el.value === '' ? null : parseInt(el.value, 10);
      else S.stacks[i].type = el.value || null;
      rebuild = true;
    } else if (el.dataset.ti != null) {
      const t = S.types[+el.dataset.ti], f = el.dataset.tf;
      if (f === 'name' || f === 'mat') t[f] = el.value; else { const v = num(el.value); if (v == null) return; t[f] = v; }
      rebuild = f === 'mat';
    } else if (el.dataset.ok) {
      const key = el.dataset.ok, f = el.dataset.of;
      S.overrides[key] = S.overrides[key] || {};
      if (f === 'mat') S.overrides[key].mat = el.value; else { const v = num(el.value); if (v == null) return; S.overrides[key][f] = v; }
      el.classList.add('ovr');
    } else if (el.dataset.mi != null) {
      const m = cfg.materials[+el.dataset.mi], f = el.dataset.mf;
      if (f === 'name') m.name = el.value;
      else { const v = el.value === '' ? null : num(el.value); m[f] = v == null ? null : v * parseFloat(el.dataset.ms); m.src = m.src || {}; m.src[f] = 'user'; }
    } else if (el.id === 'stSel') { selStack = parseInt(el.value, 10); rebuild = true; }
    else return;
    U.changed();
    if (e.type === 'change' || (rebuild && el.tagName === 'SELECT')) setTimeout(renderString, 0);
    void rebuild;
  }

  /* =====================================================================
   * PROBABILITY & PARAMETRIC
   * ===================================================================== */
  let studyOpts = null, lastCells = null, lastSpec = null, selCell = null;
  function renderProbForm() {
    const cfg = U.cfg, P = FP.study.PARAMS, sel = $('#stParam');
    const cur = sel.value || 'none';
    sel.innerHTML = Object.keys(P).filter(k => P[k].types.indexOf(cfg.pipe.type) >= 0).map(k => '<option value="' + k + '">' + esc(P[k].label) + '</option>').join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'none';
    $('#stValuesRow').hidden = sel.value === 'none';
    const prevSel = new Set($$('#stGrades input:checked').map(i => i.value));
    $('#stGrades').innerHTML = U.library.map((g, i) => '<label class="row check"><input type="checkbox" id="stg-' + i + '" value="' + esc(g.id) + '"' + ((prevSel.size ? prevSel.has(g.id) : g.id === cfg.grade.id) ? ' checked' : '') + '><span>' + esc(g.name) + (g.id === cfg.grade.id ? ' (current)' : '') + '</span></label>').join('');
    let geomText = '';
    try { geomText = FP.results.geometryText(cfg, FP.geometry.build(cfg)); } catch (e) { geomText = 'invalid geometry'; }
    $('#stBase').textContent = 'Base case: ' + geomText + '; feed ' + (cfg.feed.mode === 'mass' ? cfg.feed.massFlow + ' t/h' : cfg.feed.partRate + ' stones/s') + ', continuous. All other inputs as in the Simulate panel. The current grade edits are used for the current grade.';
    const nw = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    $('#stWorkers').textContent = 'Runs execute in ' + nw + ' parallel background workers.';
    if (!$('#stValues').value) {
      const guess = { pipeD: '700, 900, 1100', angle: '20, 35, 50', bucketBot: '700, 850, 1000', bucketTop: '1100, 1300, 1500', insertion: '150, 300, 450', massFlow: '1000, 2000, 3000', LTmean: '1.6, 2.0, 2.4' };
      $('#stValues').value = guess[sel.value] || '';
    }
    if (lastCells) drawMatrix(lastSpec, lastCells);
  }

  function runStudy() {
    if (studyOpts) return;
    const cfg = U.cfg;
    const param = $('#stParam').value;
    const values = param === 'none' ? [null] : $('#stValues').value.split(/[,;\s]+/).map(Number).filter(v => isFinite(v) && v > 0);
    const ids = $$('#stGrades input:checked').map(i => i.value);
    const grades = ids.map(id => id === cfg.grade.id ? cfg.grade : U.library.find(g => g.id === id)).filter(Boolean);
    const reps = Math.max(1, Math.min(5000, parseInt($('#stReps').value, 10) || 1)); $('#stReps').value = reps;
    const duration = parseFloat($('#stDur').value) || 0;
    const msg = $('#stMsg');
    const v = FP.units.validate(cfg);
    if (v.errors.length) { msg.textContent = 'Fix the input errors on the Simulate page first: ' + v.errors[0]; return; }
    if ((param !== 'none' && !values.length) || !grades.length) { msg.textContent = 'Select at least one grade and enter at least one positive value.'; return; }
    msg.textContent = '';
    const spec = { base: FP.config.clone(cfg), grades, param, values, reps, duration, seed0: parseInt($('#stSeed').value, 10) || 1 };
    studyOpts = { cancelled: false, stopOnRed: $('#stStop').checked };
    lastSpec = spec; lastCells = grades.map(g => (param === 'none' ? [null] : values).map(val => ({ grade: g.name, value: val, runs: [] }))); selCell = [0, 0];
    drawMatrix(spec, lastCells);
    $('#stRun').disabled = true; $('#stCancel').disabled = false;
    const t0 = performance.now();
    let lastDraw = 0;
    FP.study.run(spec, studyOpts, (i, j, cell) => {
      lastCells[i][j] = cell;
      cell.runs.forEach(r => { if (r.id && !r._stored) { r._stored = true; FP.results.store.add(r); } });
      if (performance.now() - lastDraw > 400) { lastDraw = performance.now(); drawMatrix(spec, lastCells); }
    }, (f, label) => {
      $('#stBar').style.width = (f * 100).toFixed(1) + '%';
      const el = (performance.now() - t0) / 1000;
      $('#stProg').textContent = (f * 100).toFixed(0) + '%  ' + label + (f > 0.02 ? '  (about ' + Math.max(0, el / f - el).toFixed(0) + ' s left)' : '');
    }).then(() => {
      $('#stProg').textContent = studyOpts.cancelled ? 'Cancelled.' : 'Complete in ' + ((performance.now() - t0) / 1000).toFixed(0) + ' s.';
      studyOpts = null; $('#stRun').disabled = false; $('#stCancel').disabled = true;
      drawMatrix(spec, lastCells);
    });
  }

  function pct(w) { return isFinite(w.p) ? (w.p * 100).toFixed(0) + ' % [' + (w.lo * 100).toFixed(0) + ', ' + (w.hi * 100).toFixed(0) + ']' : 'n/a'; }
  function ciBar(w, cls) {
    if (!isFinite(w.p)) return '';
    return '<span class="cibar"><span class="ci ' + cls + '" style="left:' + (w.lo * 100) + '%;width:' + Math.max(0.5, (w.hi - w.lo) * 100) + '%"></span><span class="cip" style="left:' + (w.p * 100) + '%"></span></span>';
  }

  function drawMatrix(spec, cells) {
    const P = FP.study.PARAMS[spec.param];
    const vals = spec.param === 'none' ? [null] : spec.values;
    $('#stMatrix').innerHTML = '<div class="tbl-wrap"><table class="matrix"><thead><tr><th>Grade' + (spec.param === 'none' ? '' : ' \\ ' + esc(P.label)) + '</th>' + vals.map(v => '<th>' + (v == null ? 'current setup' : v) + '</th>').join('') + '</tr></thead><tbody>' +
      spec.grades.map((g, i) => '<tr><th>' + esc(g.name) + '</th>' + vals.map((v, j) => {
        const c = cells[i][j];
        if (!c.runs.length) return '<td class="pend">queued</td>';
        const errs = c.runs.filter(r => r.error);
        const A = FP.stats.aggregate(c.runs);
        if (!A.n) return '<td class="cell-err" title="' + esc(errs[0] ? errs[0].error : '') + '">input error</td>';
        const lv = FP.detection.Detector.CLASS[A.worst].level;
        return '<td class="mcell ' + U.LEVEL_CLASS[lv] + (selCell && selCell[0] === i && selCell[1] === j ? ' selc' : '') + '" data-cell="' + i + ',' + j + '" tabindex="0"><b>P(blockage) ' + pct(A.p.persistent) + '</b>' + ciBar(A.p.persistent, 'c3') +
          '<span>P(bridging or worse) ' + pct(A.p.atLeastTemporary) + '</span><span>n = ' + A.n + ' of ' + spec.reps + (errs.length ? ', ' + errs.length + ' errors' : '') + '</span></td>';
      }).join('') + '</tr>').join('') + '</tbody></table></div><p class="note">Probabilities are fractions of runs (different seeds) with 95 % Wilson intervals. Select a cell for the full breakdown.</p>';
    if (selCell && cells[selCell[0]] && cells[selCell[0]][selCell[1]]) drawCellDetail(spec, cells[selCell[0]][selCell[1]]);
  }

  function drawCellDetail(spec, c) {
    const A = FP.stats.aggregate(c.runs);
    const el = $('#stDetail');
    if (!A.n) { el.innerHTML = ''; return; }
    const X = parseFloat($('#stX') ? $('#stX').value : '') || 100;
    const pX = (lam) => 1 - Math.exp(-lam * X);
    const r = A.rate;
    const rows = [
      ['Runs (seeds)', A.n],
      ['Free flow', A.counts.free + ' runs, ' + pct(A.p.free)],
      ['Restricted flow', A.counts.restricted + ' runs, ' + pct(A.p.restricted)],
      ['Temporary bridging', A.counts.temporary + ' runs, ' + pct(A.p.temporary)],
      ['Persistent blockage', A.counts.persistent + ' runs, ' + pct(A.p.persistent)],
      ['Restricted or worse', pct(A.p.atLeastRestricted)],
      ['Bridging or worse', pct(A.p.atLeastTemporary)],
      ['Total discharged mass (exposure, 3D eq.)', fx(A.exposure, 1) + ' t'],
      ['Blockage rate (Poisson in discharged mass)', isFinite(r.rate) ? fx(r.rate * 1000, 2) + ' per 1000 t [' + fx(r.lo * 1000, 2) + ', ' + fx(r.hi * 1000, 2) + ']' : 'n/a'],
      ['P(blockage within X t), X = <input type="number" id="stX" value="' + X + '" style="width:5em">', isFinite(r.rate) ? fx(pX(r.rate) * 100, 1) + ' % [' + fx(pX(r.lo) * 100, 1) + ', ' + fx(pX(r.hi) * 100, 1) + ']' : 'n/a'],
      ['Time to blockage: min / median / max', A.tBlock.list.length ? fx(A.tBlock.min, 1) + ' / ' + fx(A.tBlock.median, 1) + ' / ' + fx(A.tBlock.max, 1) + ' s' : 'no blockage'],
      ['Mass discharged before blockage: min / median / max', A.massBeforeBlock.list.length ? fx(A.massBeforeBlock.min, 2) + ' / ' + fx(A.massBeforeBlock.median, 2) + ' / ' + fx(A.massBeforeBlock.max, 2) + ' t' : 'no blockage'],
      ['Blockage positions (nearest feature)', Object.keys(A.featCount).length ? Object.keys(A.featCount).map(k => esc(k) + ': ' + A.featCount[k]).join('; ') : 'none'],
      ['Stones in blocking arches', A.rocks.n ? 'median ' + fx(A.rocks.perArch, 0) + ' per arch; Dn median ' + fx(A.rocks.dnMedian, 0) + ', max ' + fx(A.rocks.dnMax, 0) + ' mm; L median ' + fx(A.rocks.lMedian, 0) + ', max ' + fx(A.rocks.lMax, 0) + ' mm' : 'none']
    ];
    el.innerHTML = '<h3>' + esc(c.grade) + (c.value != null ? ', ' + esc(FP.study.PARAMS[spec.param].label) + ' = ' + c.value : '') + '</h3><dl class="kv wide">' + rows.map(x => '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>').join('') + '</dl>' +
      '<h4>Individual runs</h4><div class="tbl-wrap"><table class="data"><thead><tr><th>Seed</th><th>Status</th><th>t block [s]</th><th>Mass before block [t]</th><th>Depth [m]</th><th>Feature</th><th>Dn in arch [mm]</th><th>L in arch [mm]</th><th>Out/in</th><th></th></tr></thead><tbody>' +
      c.runs.map(x => x.error ? '<tr><td>' + esc(x.seed) + '</td><td colspan="9">' + esc(x.error) + '</td></tr>' : '<tr><td>' + x.seed + '</td><td>' + U.clsPill(x.cls) + '</td><td>' + (x.tBlock == null ? '-' : fx(x.tBlock, 1)) + '</td><td>' + (x.massOutBeforeBlock == null ? '-' : fx(x.massOutBeforeBlock, 2)) + '</td><td>' + (x.blockLocationGlobal == null ? '-' : fx(x.blockLocationGlobal, 2)) + '</td><td>' + esc(x.blockFeature || '-') + '</td><td>' + x.blockSizes.slice(0, 6).map(v => fx(v, 0)).join(', ') + '</td><td>' + (x.blockLens || []).slice(0, 6).map(v => fx(v, 0)).join(', ') + '</td><td>' + fx(x.flowRatio, 2) + '</td><td><button type="button" class="link" data-view="' + x.id + '" data-tab2="results">Open</button></td></tr>').join('') + '</tbody></table></div>' +
      '<p class="note">The blockage rate treats clogging as a Poisson process in discharged mass (Thomas & Durian 2015), with runs that did not block counted as censored exposure. It extrapolates beyond the simulated mass only under that assumption. Masses are 3D-equivalent via the slice factor.</p>';
  }

  /* =====================================================================
   * SYSTEM (future coupled modules)
   * ===================================================================== */
  function renderSystem() {
    const cfg = U.cfg;
    const status = [
      ['1', 'Continuous granular rock flow', 'physics.js, detection.js', 'implemented (quasi-2D DEM)'],
      ['2', 'Bucket and inclined fall-pipe geometry', 'geometry.js, string.js', 'implemented'],
      ['3', 'Bucket materials and structural properties', 'materials.js, string.js', 'implemented (section properties, mass, submerged weight)'],
      ['4', 'Fall-pipe shape in current (static chain) / dynamics', 'coupled/catenary.js', 'static shape in use, dynamics interface only'],
      ['5', 'Current and hydrodynamic drag', 'coupled/hydro.js', 'interface only'],
      ['6', 'Vessel motion (6 DOF)', 'coupled/vessel.js', 'interface only'],
      ['7', 'Fall Pipe ROV forces and control', 'coupled/rov.js', 'interface only'],
      ['8', 'Statistical blockage probability', 'stats.js, study.js, worker.js', 'implemented']
    ];
    let html = '<section class="card"><h3>Coupled system modules</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th>Module</th><th>Files</th><th>V2 status</th></tr></thead><tbody>' +
      status.map(s => '<tr><td>' + s[0] + '</td><td>' + s[1] + '</td><td>' + s[2] + '</td><td>' + (/interface/.test(s[3]) ? '<span class="tag stw">' + s[3] + '</span>' : '<span class="tag st0">' + s[3] + '</span>') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="note">Modules 4 to 7 store their inputs but compute nothing in V2. The rock-flow module is kept independent so it can be validated before these couplings are switched on. Coupling order per future time step: vessel state, hydrodynamic loads, ROV loads, catenary step, bucket offsets and tilts fed back to the DEM geometry, internal rock mass and wall loads fed back to the catenary.</p></section>';
    const sys = cfg.system || {};
    Object.keys(sys).forEach(k => {
      const mod = FP.coupled.mods[k];
      html += '<section class="card"><h3>' + esc(mod ? mod.info.name : k) + ' <span class="tag stw">stored, not used in V2</span></h3><div class="editgrid">' + flatFields(sys[k], 'system.' + k).join('') + '</div></section>';
    });
    $('#systemBody').innerHTML = html;
  }
  function flatFields(obj, prefix) {
    const out = [];
    Object.keys(obj).forEach(key => {
      const v = obj[key], path = prefix + '.' + key;
      if (Array.isArray(v)) { out.push('<label class="row"><span class="lab">' + esc(key) + ' (JSON)</span><span class="ctl"><input type="text" data-sys="' + path + '" data-json="1" value="' + esc(JSON.stringify(v)) + '"></span></label>'); return; }
      if (v && typeof v === 'object') { out.push.apply(out, flatFields(v, path)); return; }
      if (key === 'mode' && prefix.endsWith('rov')) { out.push('<label class="row"><span class="lab">ROV mode</span><span class="ctl"><select data-sys="' + path + '">' + [['free', 'Free body (default)'], ['controlled', 'Position control'], ['fixed', 'Fixed point (deliberate)']].map(o => '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></span></label>'); return; }
      out.push('<label class="row"><span class="lab">' + esc(path.split('.').slice(2).join(' ')) + '</span><span class="ctl"><input type="text" data-sys="' + path + '" value="' + esc(v == null ? '' : v) + '" placeholder="not set"></span></label>');
    });
    return out;
  }

  /* =====================================================================
   * events
   * ===================================================================== */
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, td[data-cell]'); if (!t) return;
      const cfg = U.cfg;
      if (t.dataset.gsel) { selGrade = t.dataset.gsel; renderGrades(); }
      else if (t.id === 'gUse') { const g = U.library.find(x => x.id === selGrade); cfg.grade = FP.config.clone(g); cfg.gradeId = g.id; U.buildForms(); U.changed(); renderGrades(); }
      else if (t.id === 'gDup') { const g = FP.config.clone(U.library.find(x => x.id === selGrade)); g.id = g.id + '-copy-' + Date.now().toString(36); g.name += ' (copy)'; g.revision = 'copy ' + new Date().toISOString().slice(0, 10); U.library.push(g); U.saveLibrary(); selGrade = g.id; renderGrades(); }
      else if (t.id === 'gDel') { if (U.library.length > 1) { U.library = U.library.filter(x => x.id !== selGrade); selGrade = null; renderGrades(); } }
      else if (t.id === 'gRestore') { const def = FP.grades.fullLibrary(); def.forEach(d => { const i = U.library.findIndex(x => x.id === d.id); if (i >= 0) U.library[i] = d; else U.library.push(d); }); U.saveLibrary(); renderGrades(); }
      else if (t.id === 'gNew') {
        const g = { id: 'user-' + Date.now().toString(36), name: 'New grade (D-values)', family: 'user', kind: 'dvalues', revision: 'R1 ' + new Date().toISOString().slice(0, 10), rho: 2650, rhoSrc: 'user input', bulkDensity: null, LmaxRatio: null, classTable: null,
          dvals: { dMin: 100, d10: 150, d50: 250, d90: 350, dMax: 400, basis: 'mass' }, shape: FP.grades.defaultShape(), measured: null, dist: { mode: 'dvalues', pos: 'mid', smoothing: 0 }, notes: 'User-defined. Enter D-values (Dn, mm) in the D-value fields.' };
        U.library.push(g); U.saveLibrary(); selGrade = g.id; renderGrades();
      }
      else if (t.id === 'impRun') { readImportOpts(); imp.rec = FP.dataset.extract(imp.rows, imp.opts); renderImport(); }
      else if (t.id === 'impSave') {
        const base = U.library.find(g => g.id === imp.baseId);
        const g = FP.config.clone(base);
        g.id = 'meas-' + Date.now().toString(36); g.name = $('#impName').value || 'Measured grade'; g.family = 'measured';
        g.rho = imp.rho; g.revision = 'imported ' + new Date().toISOString().slice(0, 10);
        g.measured = { file: imp.file, sheet: imp.sheet, masses: imp.rec.masses, rows: imp.rec.rows, ids: imp.rec.ids, missing: imp.rec.missing, nonPositive: imp.rec.nonPositive, fines: imp.fines, ld: imp.rec.ld, dims: imp.rec.dims.length ? imp.rec.dims : null, finesNote: 'entered at import', ldNote: imp.rec.ld.length ? 'Shape column values as recorded.' : '' };
        g.dist = { mode: 'empirical', pos: 'mid', smoothing: 0 };
        g.notes = 'Imported from ' + imp.file + '. Limits and table values copied from ' + base.name + ' for comparison.';
        U.library.push(g); U.saveLibrary(); selGrade = g.id; imp = null; renderGrades();
      }
      else if (t.id === 'tAdd') { const S = cfg.pipe.string; const b = FP.config.clone(S.types[0]); b.id = 'T' + (S.types.length + 1); b.name = 'Bucket type ' + (S.types.length + 1); S.types.push(b); U.changed(); renderString(); }
      else if (t.dataset.tdel) { const S = cfg.pipe.string; const id = S.types[+t.dataset.tdel].id; S.types.splice(+t.dataset.tdel, 1); (S.stacks || []).forEach(s => { if (s && s.type === id) s.type = null; }); U.changed(); renderString(); }
      else if (t.dataset.oclr) { delete cfg.pipe.string.overrides[t.dataset.oclr]; U.changed(); renderString(); }
      else if (t.id === 'mAdd') { cfg.materials.push({ id: 'M' + Date.now().toString(36).slice(-4), name: 'Custom material', rho: 1000, E: 1e9, nu: 0.4, sAllow: 10e6, mrs: null, rough: null, mu: 0.3, e: 0.3, muRoll: 0.05, src: {}, note: 'User-defined.' }); U.changed(); renderString(); }
      else if (t.dataset.mdel) { cfg.materials.splice(+t.dataset.mdel, 1); U.changed(); renderString(); }
      else if (t.id === 'mReset') { const custom = cfg.materials.filter(m => !FP.materials.DEFAULT_MATERIALS.some(d => d.id === m.id)); cfg.materials = FP.config.clone(FP.materials.DEFAULT_MATERIALS).concat(custom); U.changed(); renderString(); }
      else if (t.id === 'stRun') runStudy();
      else if (t.id === 'stCancel') { if (studyOpts) { studyOpts.cancelled = true; FP.study.cancelAll(); } }
      else if (t.dataset.cell) { selCell = t.dataset.cell.split(',').map(Number); drawMatrix(lastSpec, lastCells); }
      if (t.dataset && t.dataset.tab2) { U.S.selectedRun = t.dataset.view; U.switchTab('results'); }
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.closest && el.closest('#stringBody')) onStringInput(e);
      else if (el.id === 'gFile' && el.files[0]) onFile(el.files[0]);
      else if (el.id === 'impSheet') { const X = window.XLSX; imp.sheet = el.value; setImport(imp.file, sheetRows(X, imp.wb.Sheets[el.value]), imp.sheets, el.value, imp.wb); }
      else if (el.dataset && el.dataset.gk) {
        const g = U.library.find(x => x.id === selGrade); const k = el.dataset.gk;
        let v = el.value;
        if (el.type === 'number') v = v === '' ? null : parseFloat(v);
        U.setP(g, k, v); U.saveLibrary();
        if (U.cfg.grade.id === g.id) { U.cfg.grade = FP.config.clone(g); U.buildForms(); U.changed(); }
        renderGrades();
      }
      else if (el.dataset && el.dataset.sys) {
        let v = el.value;
        if (el.dataset.json) { try { v = JSON.parse(v); } catch (err) { el.classList.add('bad'); return; } }
        else if (v === '') v = null; else if (isFinite(+v)) v = +v;
        el.classList.remove('bad'); U.setP(U.cfg, el.dataset.sys, v); U.changed();
      }
      else if (el.id === 'stParam') { $('#stValues').value = ''; renderProbForm(); }
      else if (el.id === 'stX' && lastCells) drawMatrix(lastSpec, lastCells);
    });
    document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#stringBody') && e.target.type !== 'checkbox' && e.target.tagName === 'INPUT') onStringInput(e); });
  }

  /* =====================================================================
   * VALIDATION BENCHMARKS
   * ===================================================================== */
  const BENCH_STORE = { hopper: null, pipe: null };
  function benchCfg(kind, R) {
    const c = FP.config.defaultConfig();
    c.grade = FP.config.clone(FP.grades.fullLibrary().find(x => x.id === 'batch-lma40-200'));
    c.shape.mode = 'sphere'; c.shape.uniform = true;
    c.physics.fluid = false; c.water.model = 'still';
    const mu = kind === 'hopper' ? 0.5 : 0.4;
    Object.assign(c.physics, { muPP: mu, muPW: mu, wallContactFrom: 'global', wallStiffMode: 'same', muRollPP: 0, muRollPW: 0 });
    const ds = 2 * FP.particles.factory(c.grade, c).stats.sample[0].a * 1000;
    if (kind === 'hopper') {
      const dTop = Math.round(12 * ds), dBot = Math.round(R * ds), h = Math.round((dTop - dBot) / 2 / Math.tan(35 * Math.PI / 180));
      const S = c.pipe.string; S.nStacks = 1; S.bucketsPerStack = 1; S.types[0] = Object.assign(S.types[0], { dTop, dBot, h, t: 20, ins: 0, mat: 'S355' });
      c.pipe.feedLen = Math.round(4 * ds); c.feed.opening = dTop; c.feed.massFlow = 400000; c.feed.maxStones = 200; c.feed.v0Mode = 'input'; c.feed.v0 = 0.5;
      c.run.duration = 40; c.detect.tPersist = 3;
    } else {
      c.pipe.type = 'inclined'; Object.assign(c.pipe.inclined, { angle: 90, angleRef: 'horizontal', d: Math.round(R * ds), L: Math.round(20 * ds), mat: 'S355' });
      c.pipe.feedLen = Math.round(1.2 * ds); c.feed.opening = c.pipe.inclined.d; c.feed.maxStones = 1; c.feed.prefill = true; c.feed.settle = 3; c.run.duration = 12;
    }
    return c;
  }
  function runBench() {
    const cases = [['hopper', [2, 3, 4, 5, 6]], ['pipe', [2.2, 2.6, 3.0, 3.5, 4.0]]];
    const jobs = [];
    cases.forEach(([kind, Rs]) => Rs.forEach(R => { const cfg = benchCfg(kind, R); for (let k = 0; k < 12; k++) jobs.push({ cfg, seed: 1 + k * 7919, kind, R }); }));
    const res = {};
    $('#benchRun').disabled = true;
    FP.study.runJobs(jobs, { cancelled: false, stopOnRed: false }, (job, r) => {
      const key = job.kind + ':' + job.R; res[key] = res[key] || { n: 0, jam: 0, err: 0 };
      if (r.error) { res[key].err++; return; }
      res[key].n++; if (r.aliveN > 2) res[key].jam++;
    }, (f) => { $('#benchProg').textContent = (f * 100).toFixed(0) + ' % of ' + jobs.length + ' runs'; }).then(() => {
      $('#benchRun').disabled = false; $('#benchProg').textContent = 'Done.';
      const ref = { 'hopper:2': 'always jams', 'hopper:5': 'never jams', 'hopper:6': 'no jams', 'pipe:2.2': 'flows (below 2.45)', 'pipe:2.6': 'clogs (2.45 to 3)', 'pipe:3': 'flows above about 2.9', 'pipe:3.5': 'flows', 'pipe:4': 'flows' };
      $('#benchOut').innerHTML = '<div class="tbl-wrap"><table class="data"><thead><tr><th>Test</th><th>Opening / disk diameter</th><th>Clogged runs</th><th>Fraction [95 % CI]</th><th>Experiment</th></tr></thead><tbody>' +
        cases.map(([kind, Rs]) => Rs.map(R => { const v = res[kind + ':' + R] || { n: 0, jam: 0 }; const w = FP.stats.wilson(v.jam, v.n);
          return '<tr><td>' + (kind === 'hopper' ? '2D hopper, 200 disks' : '2D pipe, packed column') + '</td><td>' + R + '</td><td>' + v.jam + ' / ' + v.n + '</td><td>' + (isFinite(w.p) ? (w.p * 100).toFixed(0) + ' % [' + (w.lo * 100).toFixed(0) + ', ' + (w.hi * 100).toFixed(0) + ']' : '-') + '</td><td>' + (ref[kind + ':' + R] || 'intermediate') + '</td></tr>'; }).join('')).join('') + '</tbody></table></div>';
    });
  }
  document.addEventListener('click', (e) => { if (e.target.id === 'benchRun') runBench(); });

  U.pages = { grades: renderGrades, string: renderString, prob: renderProbForm, system: renderSystem };
  U.onPrepared = () => { if (!$('#tab-string').hidden) { /* keep focus while typing */ } };
  U.onTheme = () => { if (!$('#tab-grades').hidden) renderGrades(); if (!$('#tab-prob').hidden && lastCells) drawMatrix(lastSpec, lastCells); };
  bind();
})(self.FP = self.FP || {});
