/* ==========================================================================
 * js3d/geometry3d.js
 * Axisymmetric 3D geometry of the DEM window.
 *
 * Built on the shared 2D geometry (geometry.js), which already holds the
 * string, the DEM window, the pipe shape solution, features, widthAt(s) and
 * the feed chute. The 3D model uses its own frame along the pipe axis:
 *
 *   z  axial, downstream positive (z = s, window inlet at s = 0)
 *   x  lateral, in the plane of the pipe tilt; gravity pulls towards -x
 *      when the pipe is tilted (bucket string) or inclined (side pipe)
 *   y  lateral, normal to the tilt plane
 *
 * Every wall (bucket cone, wall thickness, lip, insertion ledge, feed chute,
 * funnel, restart gate) is a closed quadrilateral in the meridian half-plane
 * (s, rho) that is revolved about the axis. A sphere touches a revolved
 * segment at the closest point in its own meridian plane, which makes the
 * contact search exact and cheap.
 *
 * As in 2D, the DEM pipe is straight; a tilted or curved string turns the
 * gravity vector by the local link angle (curvature terms neglected).
 * ========================================================================== */
(function (FP) {
  'use strict';

  function build(cfg, materials) {
    // lower string and outlet: the DEM window ends at the last bucket (pipe outlet), so the nozzle / deflector can be added
    const O = cfg.pipe.outlet || {};
    if (cfg.pipe.type === 'bucket' && (O.toEnd || O.on)) {
      const str = FP.string.build(cfg, materials || cfg.materials, cfg.physics.fluid ? cfg.physics.rhoF : 1025, cfg.physics.g);
      const n = str.buckets.length, cnt = Math.max(1, Math.min(n, Math.round(cfg.pipe.string.window.count)));
      cfg = Object.assign({}, cfg, { pipe: Object.assign({}, cfg.pipe, { string: Object.assign({}, cfg.pipe.string, { window: { auto: false, start: n - cnt + 1, count: cnt } }) }) });
    }
    const geo = FP.geometry.build(cfg, materials);   // shared 2D build (string, window, shape, features)
    const W = [];                                       // wall segments in (s, rho)
    const quad = (pts, mat, meta) => {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        W.push(Object.assign({ s1: p[0], r1: p[1], s2: q[0], r2: q[1], mat }, meta || {}));
      }
    };
    const mIdx = (id) => { let k = geo.mats.indexOf(id); if (k < 0) { geo.mats.push(id); k = geo.mats.length - 1; } return k; };
    let rOuter = 0;
    if (geo.type === 'bucket') {
      geo.buckets.forEach((bk, i) => {
        const mk = mIdx(bk.mat);
        quad([[bk.sTop, bk.rT], [bk.sBot, bk.rB], [bk.sBot, bk.rB + bk.th], [bk.sTop, bk.rT + bk.th]], mk, { bucket: i });
        rOuter = Math.max(rOuter, bk.rT + bk.th);
      });
    } else {
      const I = geo.incline, mk = mIdx(cfg.pipe.inclined.mat);
      quad([[0, I.D / 2], [I.L, I.D / 2], [I.L, I.D / 2 + I.t], [0, I.D / 2 + I.t]], mk, { bucket: 0 });
      rOuter = I.D / 2 + I.t;
    }
    // outlet nozzle (FP ROV) and deflector plate below the last bucket
    geo.outlet = null;
    if (cfg.pipe.type === 'bucket' && O.on) {
      const last = geo.buckets[geo.buckets.length - 1], s0 = last.sBot, r0 = last.rB;
      const len = Math.max(0.05, (O.len || 1000) / 1000), rO = Math.min(r0, Math.max(0.05, (O.d || 800) / 2000)), t = Math.max(0.01, (O.t || 20) / 1000);
      const mk = mIdx(O.mat || 'S355');
      quad([[s0, r0], [s0 + len, rO], [s0 + len, rO + t], [s0, r0 + t]], mk, { bucket: -4, nozzle: true });
      const L0 = geo.L, inner = geo.widthAt;
      geo.L = s0 + len;
      geo.widthAt = (s) => (s > L0 && s <= L0 + len) ? 2 * (r0 + (rO - r0) * (s - L0) / len) : inner(Math.min(s, L0));
      geo.features.push({ s: geo.L, kind: 'opening', label: 'Outlet nozzle (FP ROV), ID ' + Math.round(2000 * rO) + ' mm', width: 2 * rO });
      geo.outlet = { s0, len, d: 2 * rO };
      let plateR = 0;
      if (O.deflector) {
        const sp = geo.L + Math.max(0.05, (O.gap || 600) / 1000); plateR = Math.max(rO + 0.1, (O.plateD || 2000) / 2000);
        quad([[sp, 0], [sp, plateR], [sp + 0.04, plateR], [sp + 0.04, 0]], mk, { bucket: -3, deflector: true });
        geo.outlet.plate = { s: sp, r: plateR };
        geo.exitS = sp + 0.6;
      } else geo.exitS = geo.L + Math.max(0.4, 0.3 * geo.inletWidth);
      rOuter = Math.max(rOuter, plateR + 0.3);
      geo.minPassage = Infinity;
      for (let k = 0; k <= 400; k++) geo.minPassage = Math.min(geo.minPassage, geo.widthAt(geo.L * k / 400));
    }
    // feed chute / funnel
    {
      const fl = geo.feedLen, Wi = geo.inletWidth, Wt = geo.feedTopWidth, t = 0.02, mk = mIdx(geo.feedMat);
      quad([[-fl, Wt / 2], [0, Wi / 2], [0, Wi / 2 + t], [-fl, Wt / 2 + t]], mk, { feed: true, bucket: -1 });
      rOuter = Math.max(rOuter, Wt / 2 + t);
    }
    // restart gate across the outlet
    if (cfg.feed && cfg.feed.prefill) {
      const w2 = geo.widthAt(geo.L) / 2 + 0.05, gt = 0.03;
      quad([[geo.L, 0], [geo.L, w2], [geo.L + gt, w2], [geo.L + gt, 0]], 0, { gate: true, bucket: -2 });
    }
    geo.wsegs = W;
    geo.rOuter = rOuter;
    geo.rAt = (s) => geo.widthAt(s) / 2;

    // gravity direction per axial position (unit components in the pipe frame)
    const sh = geo.shape && geo.shape.active ? geo.shape : null;
    if (geo.type === 'inclined') {
      const th = geo.axisAngleH, gx = -Math.cos(th), gz = Math.sin(th);
      geo.gAt = () => [gx, gz];
    } else if (sh) {
      geo.gAt = (s) => { const th = sh.thetaAt(Math.max(0, s + (geo.s0Global || 0))); return [-Math.sin(th), Math.cos(th)]; };
    } else geo.gAt = () => [0, 1];

    // domain box and volume
    const m = 0.3;
    geo.box = { r: rOuter + m, z0: -geo.feedLen - m, z1: geo.exitS + m };
    let vol = 0; const N = 400, z0 = -geo.feedLen, z1 = geo.exitS;
    for (let k = 0; k < N; k++) { const s = z0 + (z1 - z0) * (k + 0.5) / N; const r = geo.widthAt(Math.min(s, geo.L)) / 2; vol += Math.PI * r * r * (z1 - z0) / N; }
    if (geo.outlet && geo.outlet.plate) vol += Math.PI * geo.outlet.plate.r * geo.outlet.plate.r * (geo.outlet.plate.s - geo.L) / 3;   // rock pile on the plate (cone)
    geo.volume = vol;
    geo.is3d = true;
    return geo;
  }

  FP.geometry3d = { build };
})(self.FP = self.FP || {});
