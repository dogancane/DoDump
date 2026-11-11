# Changelog

## 0.6 (2026-11-10)

- Faster engine, same results (checked against 0.5 on the default case, a 4000 t/h surge case and a 3000 t/h conveyor case; identical outflow, overlaps and stone positions):
  - stones whose bounding sphere is clear of every wall skip the wall test
  - contact sphere positions are computed only for stones near another stone or a wall
  - box filter between two stones before the sphere-by-sphere test
  - Verlet neighbour list for stone pairs, rebuilt when a stone has moved half the skin or the stone set changed
- About 2 to 3.5 times faster; the gain is largest for small grades (CP 90/250 at 1000 t/h: 62 to 18 s of computing per simulated second).
- 3D view: only the stones in use are sent to the graphics card each frame (before: the full capacity, up to 4000 stones and 96 000 contact spheres, which stalled the view with small grades).
- The background clock no longer takes over while the tab is visible and frames are slow; it only runs the simulation when the tab is hidden.

## 0.5 (2026-11-02)

- Feed patterns: even, surges (slug of mean rate x interval released over a short time) and intermittent (on / off). Rock that does not fit at the inlet waits and enters as the pipe takes it.
- Lower string and outlet: DEM window at the end of the string, outlet nozzle (FP ROV), and a flat surface below the outlet for the rock berm, seabed or a deflector plate.
- Stones entering a window below the pipe top get the speed of their own fall from the pipe top (air, then water), per stone.
- Rock share of the pipe volume (volume fraction): live readout, chart, run results, Probability tab and PDF report.
- Feed acceptance measured against the requested feed pattern.
- New study parameters: surge interval, outlet nozzle ID, buckets in the window at the string end.

## 0.4 (2026-10-29)

- Hertz-Mindlin contact law (default): stiffness from the elastic modulus and Poisson ratio of rock and wall material, damping from restitution. Replaces the softened spring with its target-overlap setting. Soft HDPE and stiff steel walls now respond differently without a tuning factor.
- Shape- and Reynolds-dependent drag after Bagheri and Bonadonna (2016), in water and air. Replaces the fixed Cd of 1.0.
- Rotational drag torque in water and air (Dennis, Singh and Ingham 1980).
- Time step from the Hertz contact time at the highest expected impact speed.
- PDF report from the Probability tab: summary, result matrix, chart with 95 % intervals, breakdown per case, model inputs, reading guide.
- Source notes on the friction, restitution, rolling resistance and elastic modulus inputs.

## 0.3 (2026-10-27)

- Conveyor discharge feed added: belt speed, direction, drop below the head pulley, stream width, release scatter and forward spin. Stones now hit the funnel or the first bucket wall in the moonpool and enter the water tumbling.
- Vessel motion added: regular roll, pitch and heave with random phases per run, applied as apparent gravity in the pipe frame (gravity tilt, acceleration of the pipe at depth below the roll centre, heave acceleration).
- Numerical precision presets added (Standard, High, Very high). High is the default: overlap at most 1 % of Dn50 at the terminal velocity of Dn90, time step at most 0.10 of the contact time.
- New outputs:
  - wall impacts per bucket (count, energy, peak normal speed)
  - stone speed and long-axis angle at the water surface
- Probability tab added: headless runs in Web Workers, grade against parameter matrix, Wilson intervals, Poisson blockage rate per 1000 t, run table with Replay in Simulate.
- 3D validation benchmark added: silo clogging with identical spheres at D/d 3, 4 and 6 against Zuriguel et al. (2005).

## 0.2 (2026-10-27)

- Fixed a false blockage caused by the contact model. Block stones had spheres at the corners of the full L x B x T box, which made them up to 40 % wider across the diagonal than L. Stones smaller than the opening wedged across the bucket lips.
- Stone body changed to a superellipsoid in L x B x T, with the exponent set by the volume factor (p = 2.33 at 0.6). All contact spheres are inscribed in the body. The drawn stone is the same body.
- Inertia now computed from the superellipsoid.
- Dome card shows L x B x T of a jammed single stone against the passage.
- At 4000 t/h with 800 mm bucket bottoms, blocked runs fell from 6 of 6 seeds to 1 of 6. The one remaining blockage is a genuine multi-stone dome.

## 0.1 (2026-10-27)

- First 3D version, built from the 2D app: 6-degree-of-freedom sphere clumps, revolved bucket walls, shared 1D water column, 12-sector dome detection, WebGL view.
- Time step from the rotational effective mass, so that settled packs come to rest.
