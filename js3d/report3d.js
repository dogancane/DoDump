/* ==========================================================================
 * js3d/report3d.js
 * PDF report of a Probability study (jsPDF 2.5.1 + jspdf-autotable 3.8.2,
 * loaded from cdnjs on first use). Contents: study setup, result matrix,
 * probability chart with 95 % intervals, per-case breakdown, model inputs,
 * reading guide and limitations. Saved as a file (browser download, or the
 * claude.ai "downloads" capability when the page runs as an artifact).
 * ========================================================================== */
(function (FP) {
  'use strict';

  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
  ];
  let libsReady = null;
  function loadLibs() {
    if (libsReady) return libsReady;
    libsReady = LIBS.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src.split('/').slice(-3, -1).join(' ')));
      document.head.appendChild(s);
    })), Promise.resolve()).catch(e => { libsReady = null; throw e; });
    return libsReady;
  }

  const ASCII = (s) => String(s == null ? '' : s).replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/°/g, ' deg').replace(/[^\x20-\x7E\n]/g, '');
  const f = (v, d) => (v == null || !isFinite(v)) ? 'n/a' : Number(v).toFixed(d == null ? 2 : d);
  const pct = (w) => isFinite(w.p) ? (w.p * 100).toFixed(1) + ' % [' + (w.lo * 100).toFixed(1) + ', ' + (w.hi * 100).toFixed(1) + ']' : 'n/a';

  /** Compact, persistable description of the inputs of a study (taken when the study starts). */
  function inputsSummary(cfg) {
    const P = cfg.physics, W = cfg.water || {}, F = cfg.feed, V = cfg.vessel || {}, S = cfg.pipe.shape || {};
    let geom = '';
    try { geom = FP.results.geometryText(cfg, FP.geometry.build(cfg)); } catch (e) { geom = 'n/a'; }
    const mats = (cfg.materials || []).map(m => m.id + ': mu ' + m.mu + ', e ' + m.e + ', E ' + (m.E / 1e9) + ' GPa, nu ' + m.nu).join('; ');
    return [
      ['Fall pipe', geom],
      ['Pipe top above water', (cfg.pipe.dryLen / 1000) + ' m'],
      ['Pipe shape', S.mode === 'vertical' || !S.mode ? 'vertical' : S.mode + (S.mode === 'tilt' || S.mode === 'joints' ? ', ' + S.tilt + ' deg' : '') + (S.mode === 'current' ? ', current ' + S.U0 + ' m/s' : '')],
      ['Feed pattern', (F.pattern || 'even') === 'surges' ? 'surges: ' + (F.massFlow * F.surge.interval / 3600).toFixed(2) + ' t every ' + F.surge.interval + ' s over ' + F.surge.duration + ' s' : (F.pattern === 'intermittent' ? 'intermittent: ' + F.cycle.on + ' s on, ' + F.cycle.off + ' s off' : 'even')],
      ['Pipe outlet', cfg.pipe.outlet && cfg.pipe.outlet.on ? 'nozzle to ' + cfg.pipe.outlet.d + ' mm over ' + cfg.pipe.outlet.len + ' mm' + (cfg.pipe.outlet.deflector ? ', deflector plate ' + cfg.pipe.outlet.plateD + ' mm at ' + cfg.pipe.outlet.gap + ' mm' : '') : (cfg.pipe.outlet && cfg.pipe.outlet.toEnd ? 'window at the string end, open outlet' : 'not simulated, window at the top of the string')],
      ['Feed', (F.mode === 'count' ? F.partRate + ' stones/s' : F.massFlow + ' t/h') + ', ' + (F.source === 'conveyor' ? 'conveyor ' + F.belt.speed + ' m/s at ' + F.belt.dir + ' deg, drop ' + F.belt.drop + ' m, stream ' + F.belt.width + ' mm' : 'drop at rest, v0 ' + F.v0 + ' m/s') + ', centre offset ' + F.offset + ' mm'],
      ['Vessel motion', V.on ? 'roll ' + V.rollAmp + ' deg / ' + V.rollT + ' s, pitch ' + V.pitchAmp + ' deg / ' + V.pitchT + ' s, heave ' + V.heaveAmp + ' m / ' + V.heaveT + ' s' : 'off'],
      ['Stone shape model', cfg.shape.mode === 'rock' ? (cfg.shape.shapeModel === 'lt' ? 'L/T distribution (ellipsoids)' : 'shape classes, block volume factor ' + ((cfg.grade.shape && cfg.grade.shape.vfBlock) || 0.6)) : cfg.shape.mode],
      ['Contact law', (P.contactLaw === 'hertz' ? 'Hertz-Mindlin, rock E ' + (P.Erock / 1e9) + ' GPa, nu ' + P.nuRock : 'linear spring (softened)') + ', precision ' + (P.precision || 'standard')],
      ['Rock-rock friction / restitution / rolling', P.muPP + ' / ' + P.ePP + ' / ' + P.muRollPP],
      ['Rock-wall contact', P.wallContactFrom === 'global' ? 'mu ' + P.muPW + ', e ' + P.ePW + ', rolling ' + P.muRollPW : 'from wall material'],
      ['Wall materials', mats],
      ['Water', P.fluid ? (W.model === 'coupled' ? 'coupled water column' : 'still water') + ', rho ' + P.rhoF + ' kg/m3, drag ' + (P.dragModel === 'bb' ? 'Bagheri & Bonadonna 2016 (shape and Re)' : 'fixed Cd ' + P.cd) + ', added mass ' + W.Ca + (W.hindered ? ', hindered settling' : '') + (P.rotDrag ? ', rotational drag' : '') : 'none (dry)'],
      ['Detection', 'stall speed ' + cfg.detect.vStall + ' m/s, persistence ' + cfg.detect.tPersist + ' s, blocked at outlet/nominal <= ' + cfg.detect.rBlock]
    ];
  }

  async function saveFile(name, blob, doc) {
    if (window.claude && window.claude.use) {
      let dl = null;
      try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
      if (dl) { await dl.save({ filename: name, data: blob }); return 'saved'; }
    }
    doc.save(name); return 'saved';
  }

  /**
   * Build and save the report.
   * spec: study spec (grades, param, values, reps, duration, seed0, summary), cells: result cells.
   */
  async function create(spec, cells, meta) {
    await loadLibs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    if (typeof doc.autoTable !== 'function') throw new Error('Table plugin did not load.');
    const PW = 210, M = 16, CW = PW - 2 * M;
    const INK = [19, 34, 44], MUTED = [90, 106, 116], ACC = [11, 106, 134], LINE = [210, 218, 222];
    const ST = [[47, 138, 87], [201, 154, 0], [220, 100, 24], [196, 40, 44]];
    const P = FP.study3d.PARAMS[spec.param] || FP.study3d.PARAMS.none;
    const vals = spec.param === 'none' ? [null] : spec.values;
    const now = new Date();
    let y = M;

    const text = (t, x, yy, o) => { doc.text(ASCII(t), x, yy, o || {}); };
    const para = (t, size, col) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size || 9); doc.setTextColor.apply(doc, col || INK);
      const lines = doc.splitTextToSize(ASCII(t), CW);
      if (y + lines.length * (size || 9) * 0.42 > 280) { doc.addPage(); y = M; }
      doc.text(lines, M, y); y += lines.length * (size || 9) * 0.42 + 2;
    };
    const h2 = (t) => {
      if (y > 255) { doc.addPage(); y = M; }
      y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor.apply(doc, INK); text(t.toUpperCase(), M, y);
      doc.setDrawColor.apply(doc, ACC); doc.setLineWidth(0.5); doc.line(M, y + 1.5, M + 18, y + 1.5); y += 7;
    };
    const table = (head, body, opts) => {
      doc.autoTable(Object.assign({
        startY: y, head: head ? [head.map(ASCII)] : undefined, body: body.map(r => r.map(c => ASCII(c))), margin: { left: M, right: M },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.1, overflow: 'linebreak' },
        headStyles: { fillColor: [233, 237, 239], textColor: INK, fontStyle: 'bold' }, theme: 'grid'
      }, opts || {}));
      y = doc.lastAutoTable.finalY + 5;
    };

    // ---- title block ----
    doc.setFillColor.apply(doc, ACC); doc.rect(0, 0, PW, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor.apply(doc, INK); text('DoDump 3D', M, y + 6);
    doc.setFontSize(13); doc.setTextColor.apply(doc, ACC); text('Blockage probability report', M, y + 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, MUTED);
    text(now.toLocaleString() + '   |   ' + (meta && meta.version || '3D lab') + '   |   ' + (spec.param === 'none' ? 'repeated runs of one setup' : 'varied: ' + P.label), M, y + 19);
    y += 27;

    // ---- aggregate ----
    const A = cells.map(row => row.map(c => FP.stats.aggregate(c.runs)));
    const totalRuns = A.flat().reduce((a, x) => a + x.n, 0), planned = spec.grades.length * vals.length * spec.reps;

    h2('Summary');
    const best = [], worst = [];
    A.forEach((row, i) => row.forEach((a, j) => { if (a.n) { const it = { i, j, p: a.p.persistent }; best.push(it); } }));
    best.sort((a, b) => a.p.p - b.p.p);
    const lab = (it) => spec.grades[it.i].name + (vals[it.j] == null ? '' : ', ' + P.label.replace(/ \[.*$/, '') + ' = ' + vals[it.j]);
    para(totalRuns + ' of ' + planned + ' planned runs completed (' + spec.reps + ' seeds per case, ' + (spec.duration > 0 ? spec.duration + ' s' : 'Simulate tab duration') + ' of dumping per run' + (meta && meta.stopOnRed ? ', runs stopped at persistent blockage' : '') + ').');
    if (best.length) {
      if (best.length > 1 && best[0].p.p === best[best.length - 1].p.p) para('All ' + best.length + ' cases have the same measured blockage probability, ' + (best[0].p.p * 100).toFixed(1) + ' %.');
      else {
        para('Lowest blockage probability: ' + lab(best[0]) + ', ' + pct(best[0].p) + '.');
        if (best.length > 1) para('Highest blockage probability: ' + lab(best[best.length - 1]) + ', ' + pct(best[best.length - 1].p) + '.');
      }
      // pairs that differ clearly (non-overlapping 95 % intervals)
      const diff = [];
      for (let a = 0; a < best.length; a++) for (let b = a + 1; b < best.length; b++) if (best[a].p.hi < best[b].p.lo) diff.push([best[a], best[b]]);
      para(diff.length ? diff.length + ' pair(s) of cases differ clearly (95 % intervals do not overlap), for example ' + lab(diff[0][0]) + ' against ' + lab(diff[diff.length - 1][1]) + '.' : 'No two cases differ clearly yet: all 95 % intervals overlap. More runs per case are needed to separate them.');
    }

    // ---- matrix ----
    h2('Result matrix: probability of persistent blockage');
    table(['Rock grade'].concat(vals.map(v => v == null ? 'current setup' : String(v))),
      spec.grades.map((g, i) => [g.name].concat(vals.map((v, j) => { const a = A[i][j]; return a.n ? pct(a.p.persistent) + '\nn = ' + a.n + (a.counts.temporary ? ', temporary domes ' + a.counts.temporary : '') : 'no runs'; }))),
      { didParseCell: (d) => { if (d.section === 'body' && d.column.index > 0) { const a = A[d.row.index][d.column.index - 1]; if (a && a.n) { const lv = FP.detection.Detector.CLASS[a.worst].level; d.cell.styles.fillColor = [[227, 242, 233], [251, 241, 207], [253, 230, 214], [250, 220, 220]][lv]; } } } });
    if (spec.param !== 'none') para('Columns: ' + P.label + '.', 8, MUTED);
    para('Values are the share of runs ending in persistent blockage with the 95 % Wilson interval in brackets. Two cases differ clearly only when their intervals do not overlap.', 8, MUTED);

    // ---- chart ----
    {
      const H = 62, X0 = M + 12, X1 = M + CW, Y0 = y + 4, Y1 = y + 4 + H;
      if (Y1 + 16 > 285) { doc.addPage(); y = M; }
      const yb = y + 4, ye = yb + H;
      let top = 0; A.flat().forEach(a => { if (a.n) top = Math.max(top, a.p.persistent.hi); });
      const ymax = top <= 0.1 ? 0.1 : top <= 0.25 ? 0.25 : top <= 0.5 ? 0.5 : 1;
      const Y = (p) => ye - (ye - yb) * p / ymax;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.15); doc.setTextColor.apply(doc, MUTED);
      for (let k = 0; k <= 4; k++) { const p = ymax * k / 4; doc.line(X0, Y(p), X1, Y(p)); text((p * 100).toFixed(0) + ' %', X0 - 1.5, Y(p) + 1, { align: 'right' }); }
      const nG = spec.grades.length, nV = vals.length, gw = (X1 - X0) / nV, bw = Math.min(10, gw * 0.7 / nG);
      const COLS = [[11, 106, 134], [220, 100, 24], [59, 91, 181], [47, 138, 87], [204, 121, 167], [100, 100, 100]];
      vals.forEach((v, j) => {
        const cx = X0 + gw * (j + 0.5);
        spec.grades.forEach((g, i) => {
          const a = A[i][j]; if (!a.n) return;
          const x = cx - (nG * bw) / 2 + i * bw + bw * 0.1, w = bw * 0.8, c = COLS[i % COLS.length];
          doc.setFillColor.apply(doc, c); const p = a.p.persistent;
          if (p.p > 0) doc.rect(x, Y(p.p), w, ye - Y(p.p), 'F'); else { doc.setDrawColor.apply(doc, c); doc.setLineWidth(0.4); doc.line(x, ye, x + w, ye); }
          doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.25);
          doc.line(x + w / 2, Y(p.lo), x + w / 2, Y(Math.min(ymax, p.hi))); doc.line(x + w / 2 - 1, Y(p.lo), x + w / 2 + 1, Y(p.lo)); if (p.hi <= ymax) doc.line(x + w / 2 - 1, Y(p.hi), x + w / 2 + 1, Y(p.hi));
        });
        doc.setTextColor.apply(doc, MUTED); text(v == null ? 'current setup' : String(v), cx, ye + 4, { align: 'center' });
      });
      doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.2); doc.line(X0, ye, X1, ye);
      let lx = X0; doc.setFontSize(7.5);
      spec.grades.forEach((g, i) => { const c = COLS[i % COLS.length]; doc.setFillColor.apply(doc, c); doc.rect(lx, ye + 7, 3, 2.4, 'F'); doc.setTextColor.apply(doc, INK); text(g.name, lx + 4, ye + 9); lx += 8 + doc.getTextWidth(ASCII(g.name)); });
      doc.setTextColor.apply(doc, MUTED); text('P(persistent blockage) with 95 % interval' + (spec.param === 'none' ? '' : '; x axis: ' + P.label), X0, yb - 1.5);
      y = ye + 14; void Y0; void Y1;
    }

    // ---- per case ----
    h2('Breakdown per case');
    const rows = [];
    spec.grades.forEach((g, i) => vals.forEach((v, j) => {
      const a = A[i][j], c = cells[i][j]; if (!a.n) return;
      const ok = c.runs.filter(r => !r.error);
      const hit = {}; ok.forEach(x => (x.hits || []).forEach(h => { const o = hit[h.name] || (hit[h.name] = { n: 0, E: 0 }); o.n += h.n; o.E += h.E; }));
      const hitTop = Object.keys(hit).sort((p, q) => hit[q].E - hit[p].E).slice(0, 3).map(k => k + ' ' + f(hit[k].n / ok.length, 1) + ' hits, ' + f(hit[k].E / ok.length / 1000, 1) + ' kJ').join('; ') || 'none';
      const feat = Object.keys(a.featCount).map(k => k + ' (' + a.featCount[k] + ')').join('; ') || 'none';
      rows.push([g.name + (v == null ? '' : '\n' + v),
        a.counts.free + ' / ' + a.counts.restricted + ' / ' + a.counts.temporary + ' / ' + a.counts.persistent,
        f(a.exposure, 0) + ' t',
        isFinite(a.rate.rate) ? f(a.rate.rate * 1000, 2) + ' [' + f(a.rate.lo * 1000, 2) + ', ' + f(a.rate.hi * 1000, 2) + ']' : 'n/a',
        a.tBlock.list.length ? f(a.tBlock.median, 1) + ' s / ' + f(a.massBeforeBlock.median, 1) + ' t' : '-',
        feat + (ok.some(x => x.phi) ? '\nrock share ' + f(ok.filter(x => x.phi).reduce((s2, x) => s2 + x.phi.mean, 0) / ok.filter(x => x.phi).length * 100, 1) + ' %' : ''), a.rocks.n ? 'Dn ' + f(a.rocks.dnMedian, 0) + ' (max ' + f(a.rocks.dnMax, 0) + ') mm, ' + f(a.rocks.perArch, 0) + ' per dome' : '-', hitTop]);
    }));
    table(['Case', 'Free / restricted / temp. dome / blocked', 'Rock through pipe', 'Blockages per 1000 t [95 %]', 'Median time / rock to block', 'Where it blocked', 'Stones in domes', 'Wall impacts per run (top 3)'], rows,
      { styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.3, textColor: INK, lineColor: LINE, lineWidth: 0.1, overflow: 'linebreak' } });

    // ---- inputs ----
    h2('Model inputs (base case)');
    table(['Item', 'Value'], (spec.summary || inputsSummary(FP.ui.cfg)).concat([
      ['Rock grades', spec.grades.map(g => g.name + ' (rho ' + g.rho + ' kg/m3)').join('; ')],
      ['Seeds', 'first seed ' + spec.seed0 + ', step 7919; the same seeds are used in every case'],
      ['Varied parameter', spec.param === 'none' ? 'none' : P.label + ': ' + vals.join(', ')]
    ]), { columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' } } });

    // ---- reading guide ----
    h2('How to read this report');
    para('Each run dumps rock with its own random seed: new stone masses, shapes, orientations and release points. The probability of a case is the share of its runs that ended in persistent blockage. The interval in brackets is the 95 % Wilson interval: with the evidence so far the true value lies in that range. With n runs and no blockage the upper limit is about 3/n (for example 1.5 % at 200 runs).');
    para('Blockages per 1000 t treat clogging as a random process in the rock passed through the pipe (Thomas and Durian 2015); runs without blockage count as exposure. Use it to compare cases with different flow rates or run lengths.');
    h2('Model basis and limitations');
    para('3D discrete element model of rigid rock bodies (superellipsoids in L x B x T filled with contact spheres, 6 degrees of freedom) in the revolved bucket string, coupled to a 1D water column along the pipe. ' +
      ((spec.summary || []).some(r => /Hertz/.test(r[1])) ? 'Contacts follow Hertz-Mindlin theory with the elastic moduli of rock and wall material and damping from the restitution coefficient. ' : 'Contacts use a softened linear spring. ') +
      'Drag uses the shape- and Reynolds-dependent correlation of Bagheri and Bonadonna (2016) where selected, with hindered settling, pressure gradient, added mass and rotational drag.');
    para('Not calibrated against tests of this rock on these buckets. Friction, restitution, volume factor and shape class mix are taken from literature ranges, not measurements on the actual rock. Use the results to compare cases run with the same inputs and seeds. Absolute probabilities require calibration against field or scale-test data. Not modelled: dynamic response of the string, wakes and turbulence (CFD), rock breakage.', 8.5, MUTED);

    // ---- footer ----
    const n = doc.getNumberOfPages();
    for (let k = 1; k <= n; k++) {
      doc.setPage(k); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, MUTED);
      doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.2); doc.line(M, 288, PW - M, 288);
      text('DoDump 3D blockage probability report', M, 292); text('Page ' + k + ' of ' + n, PW - M, 292, { align: 'right' });
    }
    const name = 'DoDump3D_probability_' + now.toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.pdf';
    return saveFile(name, doc.output('blob'), doc);
  }

  FP.report3d = { create, inputsSummary, loadLibs };
})(self.FP = self.FP || {});
