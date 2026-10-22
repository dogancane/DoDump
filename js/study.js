/* ==========================================================================
 * study.js
 * Repeated runs (probability) and parametric studies.
 *
 * Each job is one configuration + one seed. Jobs run in a pool of Web
 * Workers (js/worker.js) using exactly the same modules as the interactive
 * run; if workers are unavailable they run time-sliced on the main thread.
 * Results are aggregated per cell with stats.aggregate (Wilson intervals,
 * Poisson blockage rate per discharged mass).
 * ========================================================================== */
(function (FP) {
  'use strict';

  const PARAMS = {
    none: { label: 'None (repeated runs of the current setup)', types: ['bucket', 'inclined'], apply: () => {} },
    bucketBot: { label: 'Bucket bottom ID, default type [mm]', types: ['bucket'], apply: (c, v) => { c.pipe.string.types.forEach(t => { if (t.id === c.pipe.string.defaultType) t.dBot = v; }); } },
    bucketTop: { label: 'Bucket top ID, default type [mm]', types: ['bucket'], apply: (c, v) => { c.pipe.string.types.forEach(t => { if (t.id === c.pipe.string.defaultType) t.dTop = v; }); } },
    insertion: { label: 'Bucket insertion length, default type [mm]', types: ['bucket'], apply: (c, v) => { c.pipe.string.types.forEach(t => { if (t.id === c.pipe.string.defaultType) t.ins = v; }); } },
    pipeD: { label: 'Inclined pipe ID [mm]', types: ['inclined'], apply: (c, v) => { c.pipe.inclined.d = v; } },
    angle: { label: 'Inclination [deg, current convention]', types: ['inclined'], apply: (c, v) => { c.pipe.inclined.angle = v; } },
    massFlow: { label: 'Mass flow [t/h]', types: ['bucket', 'inclined'], apply: (c, v) => { c.feed.mode = 'mass'; c.feed.massFlow = v; } },
    LTmean: { label: 'Mean L/T of the shape model [-]', types: ['bucket', 'inclined'], apply: (c, v) => { c.grade.shape.LTmean = v; c.grade.shape.LTmax = Math.max(c.grade.shape.LTmax, v); } }
  };

  /* ---------------- worker pool ---------------- */
  let pool = null;
  function makePool() {
    if (pool !== null) return pool;
    try {
      const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
      const ws = [];
      for (let i = 0; i < n; i++) ws.push(new Worker('js/worker.js'));
      pool = { workers: ws, busy: ws.map(() => false) };
    } catch (e) { pool = false; }
    return pool;
  }

  /** Main-thread fallback: time-sliced run. */
  function runMain(cfg, seed, opts, onProgress) {
    return new Promise((resolve) => {
      const v = FP.units.validate(cfg);
      if (v.errors.length) { resolve({ error: v.errors[0] }); return; }
      const geom = FP.geometry.build(cfg);
      const fac = FP.particles.factory(cfg.grade, cfg);
      const dv = FP.config.derive(cfg, geom, fac);
      const eng = new FP.physics.Engine(cfg, geom, fac, dv, seed);
      const det = new FP.detection.Detector(cfg, geom, eng, dv);
      const T = cfg.run.duration;
      (function slice() {
        if (opts.cancelled) { resolve({ cancelled: true }); return; }
        const t0 = performance.now();
        while (performance.now() - t0 < 25 && eng.t < T) {
          for (let i = 0; i < 50 && eng.t < T; i++) { eng.step(); det.maybeSample(); }
          if (opts.stopOnRed && det.level >= 3) break;
        }
        onProgress && onProgress(eng.t / T);
        if (eng.t >= T || (opts.stopOnRed && det.level >= 3)) {
          const fin = det.finalize();
          const s = FP.results.summarize(cfg, geom, dv, eng, det, fin, fac);
          s.cfg = null; s.stoppedEarly = eng.t < T;
          resolve(s);
        } else setTimeout(slice, 0);
      })();
    });
  }

  /**
   * Run a list of jobs [{cfg, seed, tag}] with the pool.
   * onDone(job, result), onProgress(fraction).
   */
  function runJobs(jobs, opts, onDone, onProgress) {
    const P = makePool();
    const prog = jobs.map(() => 0);
    const report = () => onProgress(prog.reduce((a, b) => a + b, 0) / jobs.length);
    if (!P) {
      // sequential main-thread fallback
      return jobs.reduce((p, job, i) => p.then(() => opts.cancelled ? null : runMain(job.cfg, job.seed, opts, f => { prog[i] = f; report(); }).then(r => { prog[i] = 1; report(); if (!r.cancelled) onDone(job, r); })), Promise.resolve());
    }
    return new Promise((resolve) => {
      let next = 0, running = 0;
      const launch = () => {
        if (opts.cancelled) { if (!running) resolve(); return; }
        while (running < P.workers.length && next < jobs.length) {
          const wi = P.busy.indexOf(false);
          if (wi < 0) break;
          const i = next++, job = jobs[i], w = P.workers[wi];
          P.busy[wi] = true; running++;
          w.onmessage = (ev) => {
            if (ev.data.id !== i) return;
            if (ev.data.progress != null) { prog[i] = ev.data.progress; report(); return; }
            prog[i] = 1; report();
            P.busy[wi] = false; running--;
            if (!opts.cancelled) onDone(job, ev.data.result);
            if (next >= jobs.length && !running) resolve(); else launch();
          };
          w.onerror = (err) => {
            P.busy[wi] = false; running--;
            onDone(job, { error: 'Worker error: ' + (err.message || 'unknown') });
            if (next >= jobs.length && !running) resolve(); else launch();
          };
          w.postMessage({ id: i, cfg: job.cfg, seed: job.seed, opts: { stopOnRed: opts.stopOnRed } });
        }
        if (next >= jobs.length && !running) resolve();
      };
      launch();
    });
  }

  function cancelAll() {
    if (pool && pool.workers) { pool.workers.forEach(w => w.terminate()); pool = null; }
  }

  /**
   * spec: { base, grades: [grade], param, values: [num], reps, duration, seed0 }
   * onCell(i, j, cell) after each finished run (cell.runs grows), onProgress(f, text)
   */
  function run(spec, opts, onCell, onProgress) {
    const P = PARAMS[spec.param] || PARAMS.none;
    const values = spec.param === 'none' ? [null] : spec.values;
    const jobs = [];
    spec.grades.forEach((g, i) => values.forEach((v, j) => {
      for (let r = 0; r < spec.reps; r++) {
        const cfg = FP.config.clone(spec.base);
        cfg.grade = FP.config.clone(g); cfg.gradeId = g.id;
        if (v != null) P.apply(cfg, v);
        if (spec.duration > 0) cfg.run.duration = spec.duration;
        jobs.push({ cfg, seed: (spec.seed0 || 1) + r * 7919, i, j, r });
      }
    }));
    const cells = spec.grades.map(g => values.map(v => ({ grade: g.name, value: v, runs: [] })));
    return runJobs(jobs, opts, (job, res) => {
      res.seed = job.seed;
      cells[job.i][job.j].runs.push(res);
      onCell(job.i, job.j, cells[job.i][job.j]);
    }, (f) => onProgress(f, Math.round(f * jobs.length) + ' of ' + jobs.length + ' runs')).then(() => cells);
  }

  FP.study = { PARAMS, run, runMain, runJobs, cancelAll };
})(self.FP = self.FP || {});
