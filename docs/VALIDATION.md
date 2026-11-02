# Validation status and input data

DoDump 3D lab 0.4. This page lists what has been checked, what rests on literature, and what is still an assumption. Read it before using results outside relative comparisons.

## 1. Verified (implementation and numerics)

| Check | Result |
|---|---|
| Single sphere in still water | Reaches the terminal velocity of the drag correlation: 4.348 m/s simulated against 4.348 m/s analytic, no lateral drift |
| 61 stones settling on the closed restart gate (Hertz-Mindlin) | Highest speed below 0.1 mm/s after 4 s; overlap 0.7 % of stone radius (on the HDPE wall, from its real modulus) |
| Mass and count balance | Residual 0 in every run |
| Stones escaping through walls | None in the test runs |
| Contact sphere fill | All spheres inside the stone body; reaches on average 97 to 99 % of each half axis (worst 92 %); diagonal width at most 1.045 L |
| Engine against published 3D clogging (silo, identical spheres) | D/d = 3: every run jammed after 4 to 70 grains. D/d = 4 and 6: silo emptied without a loaded arch. Matches the trend in Zuriguel et al. (2005), which observed no jams above about 4.9 for spheres |

The benchmark can be rerun from the Probability tab ("Run benchmark").

## 2. Based on literature, not calibrated for this system

| Item | Basis |
|---|---|
| Normal and tangential contact | Hertz (1882) and Mindlin (1949) with damping after Tsuji et al. (1992), the default contact model of EDEM; Coulomb friction |
| Drag of non-spherical stones | Bagheri and Bonadonna (2016), fitted to free-fall experiments up to Re about 3e5 |
| Rotational drag | Dennis, Singh and Ingham (1980), sphere correlation |
| Rock elastic modulus | Intact granite, basalt, limestone about 30 to 70 GPa; default 50 GPa |
| Rolling resistance | Constant directional torque, one of the model families compared by Ai et al. (2011) |
| Rock-rock friction | Basic friction angle of rock surfaces from tilt tests about 25 to 35 deg, lower when wet (Barton and Choubey 1977); default 0.6 = tan 31 deg |
| Rock-rock restitution | Limestone blocks on limestone: normal restitution 0.03 to 0.56 depending on shape (Ji et al. 2023); default 0.3 |
| Restitution under water | Joseph et al. (2001): wet restitution depends on the Stokes number and approaches the dry value above St of about 1000. Rock impacts here have St of about 10^4 to 10^5, so dry restitution applies |
| Hindered drag | Di Felice (1994) voidage function; Richardson and Zaki exponent from Miedema |
| Water column hydraulics | Haaland friction factor, Borda-Carnot expansion loss, orifice law at joint gaps |
| Rock shape statistics | Zingg classes; Rock Manual (CIRIA/CUR/CETMEF 2007) 3.4.1.6 for L/T > 3 shares; Domokos et al. (2020) for the cube-like average fragment |
| Rock-wall friction, HDPE | Interface shear tests of granular soil on smooth HDPE geomembranes report friction angles of roughly 15 to 25 deg (mu about 0.27 to 0.47). Default 0.3 lies in this range |

## 3. Assumptions without data for this system

Replace these with measured values where possible. The Probability tab can vary the most important ones as a sensitivity check.

| Input | Default | What would fix it |
|---|---|---|
| Rock-HDPE friction, wet | 0.30 | Tilting-plate or shear-box test, wet quarried rock on a bucket wall offcut |
| Rock-rock friction | 0.60 | Tilt test on the grade |
| Restitution rock-rock, rock-wall | 0.30, 0.25 | Drop tests, or literature for the rock type |
| Rolling resistance | 0.05 | Calibration against an angle-of-repose test |
| Block volume factor V/(L B T) | 0.60 | Measured L, B, T and mass of the batch |
| Shape class mix | 55/15/15/10/5 % | Shape counts of the actual grade |
| Rock elastic modulus | 50 GPa | Quarry rock test certificate |
| Dome test, stall speed, persistence time | 12 sectors, 0.05 m/s, 2 s | Engineering judgement; editable |

## 4. Not modelled

- Dynamic response of the bucket string to waves and current (only the static shape is solved)
- Water sloshing in the pipe and air entrainment at the moonpool
- Wakes, clustering and the radial water velocity profile (needs CFD-DEM)
- Rock breakage and abrasion
- Sharp edges finer than the superellipsoid exponent

## 5. How to use results

- **Use for:** relative comparisons with the same seeds, duration and precision. For example pipe bottom ID 900 against 1100 mm, grade A against grade B, conveyor direction, roll amplitude.
- **Number of runs:** 50 to 100 seeds per cell usually separates two designs. To pin down a 5 % probability to about plus or minus 2 points, about 450 runs per cell are needed.
- **Check the numerics:** before relying on a difference, rerun the key cell at Very high precision and with rock-wall friction at 0.2 and 0.45.
- **Do not use for:** absolute blockage frequency in operation, until the inputs in section 3 are measured and the model has been compared with field or scale-test blockage data for a known pipe and grade.

## References

- Ai, J., Chen, J.-F., Rotter, J.M., Ooi, J.Y. (2011). Assessment of rolling resistance models in discrete element simulations. Powder Technology 206, 269-282.
- CIRIA, CUR, CETMEF (2007). The Rock Manual. C683.
- Cundall, P.A., Strack, O.D.L. (1979). A discrete numerical model for granular assemblies. Geotechnique 29, 47-65.
- Di Felice, R. (1994). The voidage function for fluid-particle interaction systems. Int. J. Multiphase Flow 20, 153-159.
- Domokos, G., Jerolmack, D.J., Kun, F., Torok, J. (2020). Plato's cube and the natural geometry of fragmentation. PNAS 117, 18178-18185.
- Janda, A., Zuriguel, I., Maza, D. et al. (2015). Clogging of granular materials in narrow vertical pipes discharged at constant velocity. Granular Matter 17, 545-551.
- Joseph, G.G., Zenit, R., Hunt, M.L., Rosenwinkel, A.M. (2001). Particle-wall collisions in a viscous fluid. J. Fluid Mech. 433, 329-346.
- Bagheri, G., Bonadonna, C. (2016). On the drag of freely falling non-spherical particles. Powder Technology 301, 526-544.
- Barton, N., Choubey, V. (1977). The shear strength of rock joints in theory and practice. Rock Mechanics 10, 1-54.
- Dennis, S.C.R., Singh, S.N., Ingham, D.B. (1980). The steady flow due to a rotating sphere at low and moderate Reynolds numbers. J. Fluid Mech. 101, 257-279.
- Ji, Z.-M. et al. (2023). Experimental study on the restitution coefficients of rock blocks of different shapes. Frontiers in Earth Science 11, 1257187.
- Mindlin, R.D. (1949). Compliance of elastic bodies in contact. J. Appl. Mech. 16, 259-268.
- Tsuji, Y., Tanaka, T., Ishida, T. (1992). Lagrangian numerical simulation of plug flow of cohesionless particles in a horizontal pipe. Powder Technology 71, 239-250.
- Thomas, C.C., Durian, D.J. (2015). Fraction of clogging configurations sampled by granular hopper flow. Phys. Rev. Lett. 114, 178001.
- Zuriguel, I., Garcimartin, A., Maza, D., Pugnaloni, L.A., Pastor, J.M. (2005). Jamming during the discharge of granular matter from a silo. Phys. Rev. E 71, 051303.
