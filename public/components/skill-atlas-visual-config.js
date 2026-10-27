// Small, extensible visual configuration for the Skill Atlas. Keeps sport
// identity, ring geometry, and node sizing out of the layout and render code so
// future sports can be added without touching the renderer. Gold/Staza-yellow
// is the universal progression/unlock color; sport accents are secondary only.

export const SYNTHETIC_ROOT_ID = "__athlete_root__";

// Geometry for the deterministic radial layout. Ring index maps to a radius;
// higher rings fan further out. These are virtual-world units (the viewport
// transform scales them to the screen).
export const RING_RADII = {
  base: 0, // ring 0 (root) sits at the center
  step: 190, // distance between successive rings
  first: 200 // radius of ring 1 (sport nodes)
};

// Radius of a node circle per role. Sport nodes and the root read as larger
// landmarks than ordinary skill nodes.
export const NODE_SIZES = {
  root: 46,
  sport: 40,
  crossSport: 34,
  prestige: 36,
  crossBranch: 32,
  skill: 30
};

// Secondary sport accents. Accents are intentionally subtle and never override
// the universal gold progression color. Each GPS sport owns one radial sector.
export const SPORT_VISUALS = {
  cycling: { accent: "#53c7d6", label: "Cycling" },
  running: { accent: "#e58a6b", label: "Running" },
  hiking: { accent: "#6fb98a", label: "Hiking" }
};

// Fixed angular order of sports around the circle. Adding a sport here reserves
// it an adjacent sector without any renderer change.
export const SPORT_ORDER = ["cycling", "running", "hiking"];

// Branch sub-sector order within a sport sector. The angle a node receives is
// its sport sector plus its branch offset inside that sector. Sports only use a
// subset of these keys (e.g. cycling has no `speed`/`summit`), and the layout
// only reserves sub-sectors for the branches actually present in each sport.
export const BRANCH_ORDER = ["rush", "speed", "summit", "adventure", "endurance"];

// Branches that do not form their own angular sub-sector: they are placed by the
// circular mean of their prerequisites so they sit between the sectors they join.
export const CROSS_BRANCHES = new Set(["cross", "cross_sport"]);

export const BRANCH_LABELS = {
  rush: "FLOW",
  speed: "SPEED",
  summit: "SUMMIT",
  adventure: "EXPLORE",
  endurance: "ENDURANCE"
};

export const sportVisual = (sport) =>
  SPORT_VISUALS[sport] ?? { accent: "var(--text-muted)", label: sport };
