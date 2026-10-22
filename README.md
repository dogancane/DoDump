# DoDump

Rock dumping fall pipe simulator.

A browser-based engineering tool for studying rock discharge through the fall pipe of a rock installation vessel during scour protection works. It simulates rock being dumped through a vertical moonpool fall pipe (nested conical buckets) or an inclined side fall pipe into water, and shows where and how the pipe can bridge, jam, accumulate rock or block.

The tool runs entirely in the browser. No installation, no server and no data upload are needed.

## What it does

- Simulates individual stones falling through the pipe with a discrete element model (DEM): contact forces, friction, rolling resistance, impacts with the walls and interlocking between stones.
- Includes the water effect: buoyancy, drag, hindered settling, added mass, and the water flow the falling rock drags down the pipe, including leakage at the bucket joints.
- Uses real rock grades from EN 13383 (LMA, LMB, CP and others) or your own measured batch data imported from Excel or CSV.
- Generates realistic stone shapes: blocky, long and thin, flat, bladed and rounded, with editable proportions.
- Detects flow problems automatically and reports a status:
  - GREEN: free flowing
  - YELLOW: restricted flow or accumulation
  - ORANGE: probable bridging
  - RED: persistent blockage
- Reports where a blockage formed, when, which stones were involved and how much rock was dumped before it happened.
- Runs repeated simulations to estimate blockage probability with confidence intervals.

## Typical questions it helps answer

- Will this rock grade pass through this bucket string at this dumping rate?
- Where in the string is the critical section?
- How does blockage risk change with pipe diameter, bucket overlap, feed rate or rock shape?
- How much rock can be dumped before a blockage is likely?

## Pages

- **Simulate:** set up the pipe, rock grade, feed and water, then run and watch the live simulation with charts and the total rock dumped.
- **Grades & data:** browse the grade library, edit grades and import measured batch test data.
- **Fall pipe string:** define stacks and buckets (diameters, lengths, overlaps, materials) and check the clear passage at each transition.
- **Probability:** run many simulations per case to compare blockage probability across grades, flow rates or geometries.
- **Results:** run summaries, event details and comparison between runs.
- **Diagnostics:** numerical checks and validation benchmarks.

## Getting started

1. Open the site and go to **Simulate**.
2. Choose the pipe type, bucket geometry and rock grade.
3. Set the dumping rate (t/h) and the run duration.
4. Press **Start**. Each run uses a new random stone sequence; choose "Fixed seed" under the run settings to repeat a run exactly.
5. Use **Probability** for blockage likelihood. A single run shows one possible outcome, not a probability.

## Model level and limitations

- The simulation is a quasi-2D section through the pipe axis, validated against published 2D experiments. Results are converted to full-pipe equivalent tonnes.
- A 2D section forms arches with fewer stones than a real round pipe. In narrow pipes (pipe diameter below about 7 times the median stone size) it can under-predict blockage. Use results for mechanisms and relative comparisons, and treat absolute probabilities with care.
- Stones are rigid; breakage and abrasion are not modelled. Sharp edges are approximated.
- Water flow is modelled as a 1D column. Turbulence, wakes and pressure transients are not included.
- All assumptions are labelled in the app. Default shape mixes and some material values are assumptions and should be replaced with measured data where available.

This tool supports engineering judgement. It does not replace full-scale testing or a validated 3D model for design decisions.
