/* ==========================================================================
 * worker.js
 * Web Worker that runs one simulation headless with exactly the same
 * modules as the interactive run. Message in: { id, cfg, seed, opts }.
 * Messages out: { id, progress } and { id, result }.
 * ========================================================================== */
/* global importScripts */
importScripts('coupled/system.js', 'coupled/catenary.js', 'coupled/hydro.js', 'coupled/vessel.js', 'coupled/rov.js',
  'materials.js', 'grades.js', 'particles.js', 'shapes.js', 'string.js', 'config.js', 'geometry.js',
  'water.js', 'physics.js', 'detection.js', 'results.js', 'stats.js', 'units.js');

self.onmessage = function (ev) {
  const { id, cfg, seed, opts } = ev.data;
  try {
    const res = self.FP.runner.runSync(cfg, seed, opts || {}, (f) => self.postMessage({ id, progress: f }));
    self.postMessage({ id, result: res });
  } catch (err) {
    self.postMessage({ id, result: { error: String(err && err.message || err) } });
  }
};

(function (FP) {
  'use strict';
  /** Run to completion synchronously (inside the worker). */
  function runSync(cfg, seed, opts, onProgress) {
    const v = FP.units.validate(cfg);
    if (v.errors.length) return { error: v.errors[0] };
    const geom = FP.geometry.build(cfg);
    const fac = FP.particles.factory(cfg.grade, cfg);
    const dv = FP.config.derive(cfg, geom, fac);
    const eng = new FP.physics.Engine(cfg, geom, fac, dv, seed);
    const det = new FP.detection.Detector(cfg, geom, eng, dv);
    const T = cfg.run.duration;
    let next = 0;
    while (eng.t < T) {
      eng.step(); det.maybeSample();
      if (opts.stopOnRed && det.level >= 3) break;
      if (eng.t >= next) { onProgress && onProgress(eng.t / T); next += T / 20; }
    }
    const fin = det.finalize();
    const s = FP.results.summarize(cfg, geom, dv, eng, det, fin, fac);
    s.cfg = null; // keep messages small; the study keeps its own base config
    s.stoppedEarly = eng.t < T;
    return s;
  }
  FP.runner = { runSync };
})(self.FP = self.FP || {});
