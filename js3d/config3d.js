/* ==========================================================================
 * js3d/config3d.js
 * 3D defaults and derived quantities.
 *
 * The input set is the same as the 2D page (shared config.js), so a 2D
 * configuration loads unchanged. Differences in the derived values:
 *   - no slice: the full mass flow is released (slice factor = 1)
 *   - body capacity from the domain volume, not the section area
 *   - solid fraction thresholds are VOLUME fractions (2D uses in-plane area)
 * Contact stiffness and time step use the same rules as 2D.
 * ========================================================================== */
(function (FP) {
  'use strict';

  function defaultConfig() {
    const c = FP.config.defaultConfig();
    c.dim = 3;
    c.detect.phiJam = 0.35;   // ASSUMPTION: volume fraction for a dense stalled zone (2D default 0.5 is in-plane area)
    c.run.duration = 20;
    // feed source: 'drop' (released at rest in the feed zone, moving down at v0) or 'conveyor'
    c.feed.source = 'drop';
    c.feed.belt = {
      speed: 3.0,      // m/s, belt speed = horizontal speed of the rock leaving the head pulley
      dir: 0,          // deg, azimuth of the belt direction in the pipe cross-section (0 = +x, the tilt plane)
      drop: 1.0,       // m, height from the head pulley to the release level in the feed zone (adds vertical speed)
      width: 600,      // mm, width of the rock stream across the belt direction
      scatter: 0.15,   // relative scatter of the release velocity
      spin: 0.5        // forward spin as a share of v / r (rolling off the pulley = 1)
    };
    // vessel motion: regular roll, pitch and heave, applied as apparent gravity in the pipe frame
    c.vessel = { on: false, rollAmp: 2, rollT: 9, pitchAmp: 1, pitchT: 7, heaveAmp: 0.5, heaveT: 8, zRC: 8 };
    c.physics.precision = 'high';
    c.feed.pattern = 'even';                       // 'even' | 'surges' | 'intermittent'
    c.feed.surge = { interval: 10, duration: 2 };  // s: one slug of (mean rate x interval) released over 'duration'
    c.feed.cycle = { on: 20, off: 10 };            // s: feed on, feed off
    // lower string and outlet: window at the last bucket, optional nozzle (FP ROV) and deflector plate
    c.pipe.outlet = { toEnd: false, on: false, d: 800, len: 1000, t: 20, mat: 'S355', deflector: false, gap: 1500, plateD: 3000 };
    c.physics.contactLaw = 'hertz';   // 'hertz' (Hertz-Mindlin, real moduli) | 'linear' (softened spring)
    c.physics.dragModel = 'bb';       // 'bb' (Bagheri & Bonadonna 2016, shape and Re dependent) | 'fixed' (Cd input)
    c.physics.rotDrag = true;         // rotational drag torque (Dennis et al. 1980)
    c.physics.muPP = 0.6;             // tan(31 deg): basic friction angle range of rock 25-35 deg (Barton & Choubey 1977)
    c.physics.Erock = 50e9;           // Pa, intact rock, granite / limestone range about 30-70 GPa
    return c;
  }

  /** Bring a 2D configuration into the 3D page (same inputs, 3D-specific thresholds). */
  function from2D(c2) {
    const c = FP.config.clone(c2);
    c.dim = 3;
    if (c.detect && c.detect.phiJam === 0.5) c.detect.phiJam = 0.35;
    return c;
  }

  /**
   * Numerical precision presets (contact stiffness and time step):
   *   standard   inputs as entered (2D defaults: overlap 2 % Dn50 at vChar, dt = 0.15 t_c)
   *   high       overlap <= 1 %, dt <= 0.10 t_c, vChar >= terminal velocity of Dn90
   *   very high  overlap <= 0.5 %, dt <= 0.07 t_c, vChar >= water entry speed of the dry fall
   * Stiffer contacts and smaller steps reduce artificial overlap and softness, at a run time cost
   * that grows with (vChar / overlap) and 1 / tcFactor.
   */
  function presetPhysics(cfg, fac) {
    const P = FP.config.clone(cfg.physics), pr = P.precision || 'standard';
    const st = fac.stats, G = cfg.grade;
    const vT90 = P.fluid ? Math.sqrt(4 / 3 * P.g * st.Dn90 * (G.rho - P.rhoF) / (P.rhoF * P.cd)) : 3;
    const v0 = cfg.feed.v0Mode === 'terminal' ? vT90 : cfg.feed.v0;
    const dry = P.fluid ? Math.max(0, (cfg.pipe.dryLen || 0) / 1000) : 0;
    const vEntry = Math.sqrt(v0 * v0 + 2 * P.g * dry);
    if (pr === 'high') { P.tcFactor = Math.min(P.tcFactor, 0.10); P.overlapPct = Math.min(P.overlapPct, 1.0); P.vChar = Math.max(P.vChar, vT90); }
    if (pr === 'veryhigh') { P.tcFactor = Math.min(P.tcFactor, 0.07); P.overlapPct = Math.min(P.overlapPct, 0.5); P.vChar = Math.max(P.vChar, vEntry, vT90); }
    if (P.contactLaw === 'hertz') P.tcFactor = Math.min(P.tcFactor, pr === 'veryhigh' ? 0.05 : pr === 'high' ? 0.08 : 0.12);
    return { P, vT90, vEntry, pr };
  }

  function derive(cfg, geom, fac) {
    const pp = presetPhysics(cfg, fac);
    const cfgD = Object.assign({}, cfg, { physics: pp.P });
    const dv = FP.config.derive(cfgD, geom, fac);   // shared: stiffness, time step, terminal velocity, dry fall, transit
    dv.precision = { name: pp.pr, tcFactor: pp.P.tcFactor, overlapPct: pp.P.overlapPct, vChar: pp.P.vChar, vEntry: pp.vEntry };
    cfg = cfgD;
    const st = fac.stats, F = cfg.feed;
    dv.sliceFactor = 1;
    dv.massRateSlice = F.mode === 'count' ? F.partRate * st.meanMass : F.massFlow / 3.6;
    dv.partRate = dv.massRateSlice / st.meanMass;
    dv.nominalSliceMassRate = dv.massRateSlice;
    dv.toTph = 3.6;
    dv.warmupAuto = 2 * dv.tTransit + Math.max(cfg.detect.window, 10 / Math.max(dv.partRate, 1e-6));
    dv.warmup = cfg.detect.warmupMode === 'auto' ? dv.warmupAuto : cfg.detect.warmup;
    dv.cap = Math.max(80, Math.min(4000, Math.ceil((geom.volume * 0.65 / st.meanVol + 40) * cfg.physics.capFactor)));
    // Time step: in 3D a clump contact also drives rotation, so the effective mass at the contact
    // is m_rot = 1 / (1/m + d^2/I) (d = distance of the contact from the body axis). The shortest
    // contact time uses the smallest m_rot / (Dn/2) of the stone sample (2D used m / (Dn/2)).
    const P = cfg.physics, rr = st.minRatioRot || st.minRatio;
    dv.tcPP = Math.PI * Math.sqrt(rr * dv.d50 / (4 * dv.kn));
    dv.tcPW = Math.PI * Math.sqrt(rr * dv.d50 / (2 * dv.kn * dv.kRatioMax));
    dv.tc = Math.min(dv.tcPP, dv.tcPW);
    dv.dtAuto = P.tcFactor * dv.tc;
    dv.dt = P.dtMode === 'auto' ? dv.dtAuto : P.dt;
    dv.dtOverTc = dv.dt / dv.tc; dv.stepsPerSecond = 1 / dv.dt;
    // Hertz-Mindlin with the real elastic moduli: contact duration t_c = 2.87 (m*^2 / (R* E*^2 v))^(1/5)
    // (Hertz theory, e.g. Johnson 1985), for the most exposed sphere of the stone sample (rotational
    // effective mass, smallest sphere) at the highest expected impact speed (water entry or terminal speed).
    dv.contactLaw = P.contactLaw || 'linear';
    if (dv.contactLaw === 'hertz') {
      const eS = FP.materials.eStar, Er = P.Erock, nr = P.nuRock;
      const gStar = (E1, n1, E2, n2) => 1 / ((2 - n1) / (E1 / (2 * (1 + n1))) + (2 - n2) / (E2 / (2 * (1 + n2))));
      dv.hz = { Err: eS(Er, nr, Er, nr), Grr: gStar(Er, nr, Er, nr), wall: geom.mats.map(id => { const m = FP.materials.find(cfg.materials, id); return { E: eS(Er, nr, m.E, m.nu), G: gStar(Er, nr, m.E, m.nu), name: id }; }) };
      const vImp = Math.max(3, dv.precision.vEntry || 0, dv.vTermMax || 0);
      const q = st.hzQ;   // min m_rot^2 / r over the sample
      const tcH = (mm2R, E) => 2.87 * Math.pow(mm2R / (E * E * vImp), 0.2);
      const EwMax = Math.max.apply(null, dv.hz.wall.map(w => w.E).concat([0]));
      dv.tcPP = tcH(q / 2, dv.hz.Err); dv.tcPW = EwMax > 0 ? tcH(q, EwMax) : dv.tcPP;   // pair: m* = m/2, R* = r/2
      dv.tc = Math.min(dv.tcPP, dv.tcPW); dv.vImpact = vImp;
      dv.dtAuto = P.tcFactor * dv.tc; dv.dt = P.dtMode === 'auto' ? dv.dtAuto : P.dt;
      dv.dtOverTc = dv.dt / dv.tc; dv.stepsPerSecond = 1 / dv.dt;
    }
    // terminal velocities with the shape-dependent Newton drag (Bagheri & Bonadonna 2016), deq basis
    if (P.fluid && (P.dragModel || 'fixed') === 'bb') {
      const G = cfg.grade, kN = st.kNmean || 1, Cd = 0.46 * kN;
      const vt = (Dn) => Math.sqrt(4 / 3 * P.g * Dn * Math.cbrt(6 / Math.PI) * (G.rho - P.rhoF) / (P.rhoF * Cd));
      dv.cdNewton = Cd; dv.vTerm50 = vt(st.Dn50); dv.vTermMin = vt(st.Dn10); dv.vTermMax = vt(st.Dn90);
    }
    dv.dim = 3;
    return dv;
  }

  FP.config3d = { defaultConfig, from2D, derive };
})(self.FP = self.FP || {});
