/** Grid size, path costs and negotiation limits of multiblock routing. */

/** Search margin around the structures and terminals, in blocks. */
export const MARGIN = 4;

/**
 * Largest search grid (cells) routing will allocate, about 200 MB of typed scratch buffers plus trees/maps.
 * Terminal/pass/ownership masks use 16 bits so special fluid networks retain their own reservation bits.
 * Only far-apart manual
 * layouts from links or files reach it; above it nothing is routed and every terminal reports unconnected.
 */
export const MAX_GRID_CELLS = 4_000_000;

/** Default extra cost of a pipe bend, in blocks: straighter runs for the same or fewer pipe blocks. */
export const DEFAULT_TURN_COST = 2;

/**
 * Negotiated routing (PathFinder): every kind is routed as if the others were not there, but a cell
 * another kind already uses costs more (`present` × that factor), and cells contested in earlier rounds
 * stay dearer (`history`). Kinds whose network still shares a cell are ripped up and routed again, with
 * both penalties growing, until no cell is shared. Fixed limits keep the work bounded and deterministic.
 */
export const MAX_ROUNDS = 24;

export const PRESENT_START = 2;

export const PRESENT_GROWTH = 1.6;

export const HISTORY_STEP = 1;

/** Negotiation also stops after this many rounds without fewer contested cells than before. */
export const MAX_STALLED_ROUNDS = 5;

/**
 * Default extra cost of a pipe block that touches neither the build nor the ground, in blocks. Between two
 * routes of about the same length the one along the walls wins, as players lay pipes; a pipe still crosses
 * open space when that saves more.
 */
export const DEFAULT_WALL_COST = 1;

/** Extra cost of taking a cell beside another kind's hatch (it may be that hatch's only way out). */
export const BESIDE_HATCH_COST = 1;

/** Arrival direction of a cell that is part of the network (no bend is priced leaving it). */
export const NO_DIR = 6;
