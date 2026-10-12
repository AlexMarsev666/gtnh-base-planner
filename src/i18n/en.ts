import type { SiteNote, SiteWarning } from '../model/site/buildTypes';
import type { ResourceKind } from '../model/site/types';
import type { HatchKind } from '../model/multiblock/types';
import type { IoClass, SortMode } from '../model/bom';
import type { WallshareFallback } from '../model/layout/types';
import type { WallshareMode } from '../model/plan/types';
import type { Dir } from '../model/core/types';
import type { ValidityProblem } from '../model/validity';

const HATCH_KIND_NAMES: Record<HatchKind, string> = {
  itemIn: 'Item in',
  itemOut: 'Item out',
  fluidIn: 'Fluid in',
  fluidOut: 'Fluid out',
  energy: 'Energy',
  dynamo: 'Dynamo',
  maintenance: 'Maintenance',
  muffler: 'Muffler',
  steamIn: 'Steam in',
  dataAccess: 'Data access',
};
const FACE_NAMES: Record<Dir, string> = {
  up: 'top',
  down: 'bottom',
  north: 'north',
  south: 'south',
  east: 'east',
  west: 'west',
};
const WALLSHARE_NAMES: Record<WallshareMode, string> = {
  auto: 'Auto',
  side: 'Side walls',
  stack: 'Stack',
  back: 'Back walls',
  separate: 'Separate',
};
const WALLSHARE_REASONS: Record<WallshareFallback['reason'], string> = {
  'no-wallshare': 'this machine cannot share walls',
  limits: 'limits too tight',
  geometry: 'no valid layout',
};

/** All user-visible strings (UNIT 8 owns this file). Use `t.key` in components; never build HTML strings. */
export const t = {
  appName: 'GTNH Base Planner',
  tagline: 'Multiblocks sharing walls, hatches and pipes.',
  repo: 'Source on GitHub',
  repoUrl: 'https://github.com/ryazhenkofc/gtnh-base-planner',

  // Top bar
  countLabel: 'Number of multiblocks',
  decrease: 'Fewer multiblocks',
  increase: 'More multiblocks',
  minus: '−',
  plus: '+',
  settings: 'Settings',
  close: 'Close',
  separator: '·',
  slash: '/',

  // Picker
  pickerTitle: 'Multiblocks',
  search: 'Search',
  noMatches: 'Nothing matches.',
  wallshareTag: 'Wall-share',
  /** Picker tag of catalog entries generated from the game (tools/game-dump) rather than checked by hand. */
  generatedTag: 'From game',
  generatedHint:
    'Built by the game itself (the hologram projector of GregTech 5.09.54.205) and not checked by hand: hatch counts follow the controller tooltip and structure check; check it in game.',

  // Settings drawer
  limits: 'Limits',
  limitsHint: 'Max multiblocks along each axis. Empty = unlimited.',
  limitX: 'X',
  limitY: 'Layers',
  limitZ: 'Z',
  unlimited: '—',
  size: 'Size',
  height: 'Height',
  length: 'Length',
  sizeHint: (min: number, max: number) => `Blocks, ${min} to ${max}.`,
  clamped: (label: string, min: number, max: number) =>
    `${label} is ${min} to ${max}; kept inside that range.`,
  stepUp: (label: string) => `More (${label})`,
  stepDown: (label: string) => `Less (${label})`,
  hatches: 'Hatches',
  hatchColor: (name: string) => `${name} colour`,
  resetColors: 'Reset colours',
  machine: 'Machine',
  tier: 'Tier',
  tierHint: 'Voltage tier of the energy and dynamo hatches.',
  anyTier: 'Any',
  defaultTier: 'Default',
  mirror: 'Mirror',
  mirrorHint: 'Build every machine mirrored left to right.',
  wallshare: 'Shared walls',
  wallshareHint: 'How machines may touch. A preference: if it cannot be met, another layout is used.',
  wallshareModes: WALLSHARE_NAMES,
  wallshareFallback: (wanted: WallshareMode, used: WallshareMode, reason: WallshareFallback['reason']) =>
    `${WALLSHARE_NAMES[wanted]} is not possible here (${WALLSHARE_REASONS[reason]}): used ${WALLSHARE_NAMES[used]}.`,
  hatchTiers: 'Hatch tiers',
  hatchTiersShow: (n: number) => `Set tiers of ${n} ${n === 1 ? 'hatch' : 'hatches'}`,
  hatchSelected: (kind: string) => (kind ? `Hatch selected: ${kind}` : 'Hatch selected'),
  hatchSetTier: 'Set tier',
  hatchTiersHide: 'Hide hatch tiers',
  hatchTiersSelected: 'Only hatches of the selected machines.',
  hatchTierName: (kind: string, n: number) => `${kind} ${n}`,
  hatchTiersReset: 'Hatch tiers were reset because the layout changed.',
  hatchTiersUnmatched: (n: number) => `${n} hatch ${n === 1 ? "tier doesn't" : "tiers don't"} match a hatch.`,
  hatchTiersEmpty: 'No hatches to set.',
  notAllowed: '(not allowed)',
  resetHatchTiers: 'Reset hatch tiers',
  view: 'View',
  pipes: 'Pipes',
  cables: 'Cables',
  xray: 'X-ray',
  on: 'On',
  off: 'Off',
  plan: 'Plan',
  shareLink: 'Copy share link',
  linkCopied: 'Link copied.',
  linkCopiedLong:
    'Link copied. It is long: some chat apps cut such links, so send the JSON file if it fails.',
  linkFallback: 'Copy this link:',
  linkFailed: 'Could not create a link.',
  planTooLargeForLink: 'This plan is too large for a link. Download the JSON file instead.',
  downloadJson: 'Download JSON',
  uploadJson: 'Open JSON',
  jsonLoaded: 'Plan opened.',
  jsonFailed: (msg: string) => `Could not open file: ${msg}`,
  jsonSaveFailed: 'Could not save file.',
  reset: 'Reset plan',
  resetConfirm: 'Confirm reset',
  resetDone: 'Plan reset.',
  manualNote: 'Manual layout. Changing the count or limits re-packs.',

  below: 'Connect from below',
  belowHint:
    'Hatches may face down from the lowest layer and pipes may run in a trench one block under the build.',

  // Stats line
  units: (n: number) => `${n} ${n === 1 ? 'unit' : 'units'}`,
  blocks: (n: number) => `${n} blocks`,
  sharedWalls: (n: number) => `${n} shared ${n === 1 ? 'wall' : 'walls'}`,
  hatchCount: (n: number) => `${n} ${n === 1 ? 'hatch' : 'hatches'}`,
  saved: (n: number) => `${n} saved`,
  conflicts: (n: number) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}`,
  pipeLength: (n: number) => `${n} pipe blocks`,
  /** Footprint measured along an axis in the 3D view. */
  dimension: (axis: string, n: number) => `${axis}  ${n}`,
  cableLength: (n: number) => `${n} cable blocks`,
  /** `nums` are 1-based positions in the unit list. */
  selected: (nums: number[]) => (nums.length === 1 ? `Unit ${nums[0]}` : `Units ${nums.join(', ')}`),

  // Notices
  previewUnavailable: 'Preview unavailable.',
  viewUnavailable: '3D view unavailable.',
  texturesUnavailable: 'Textures could not be loaded; showing flat colours. Reload the page to try again.',
  placedFewer: (placed: number, requested: number, reason?: 'limits' | 'geometry') =>
    `Placed ${placed} of ${requested}${reason === 'limits' ? ': limits too tight' : reason === 'geometry' ? ': no room' : ''}.`,
  spacedOut: (routed: boolean) =>
    routed ? 'Spaced out so every hatch fits and gets connected.' : 'Rearranged so every hatch fits.',
  manyUnits: (n: number) =>
    `${n} units: a build this big can take a few seconds to lay out, pipe and draw, more in DETAILED view.`,
  unplacedHatches: (n: number) => `${n} ${n === 1 ? 'hatch' : 'hatches'} could not be placed.`,
  hatchesDontFit: (needed: number, fits: number, remove: number, units: number, mandatory: boolean) =>
    `Hatches don't fit: ${needed} needed, ${fits} fit. Remove ${remove}.` +
    (mandatory ? ' Even the required hatches do not all fit.' : '') +
    (units > 1 ? ` (${units} units)` : ''),
  unconnectedPipes: (n: number) => `${n} ${n === 1 ? 'hatch is' : 'hatches are'} not connected.`,
  routingTruncated: (n: number) =>
    `${n} ${n === 1 ? 'hatch is' : 'hatches are'} not connected: routing stopped early because this build is very large.`,
  pipesRouting: 'Routing pipes…',
  machineWorkerStopped: 'The background worker stopped; pipes and cables are off until you reload.',
  sharedPrompt: 'Open shared plan? It replaces your current one.',
  sharedOpen: 'Open',
  sharedKeep: 'Keep mine',
  sharedInvalid: 'Shared link could not be read.',
  saveFailed: 'This browser is not saving the plan. Download JSON to keep it.',
  dismiss: 'Dismiss',

  // A stored plan or template that could not be read
  recovery: {
    plan: (reason: string) => `Your saved plan could not be read (${reason}). It has not been changed.`,
    site: (reason: string) => `Your saved template could not be read (${reason}). It has not been changed.`,
    keptCopy: 'A copy is kept in this browser.',
    copyFailed: 'A copy could not be kept (browser storage is full or blocked). Download it now.',
    paused: 'Changes are not saved until you choose.',
    download: 'Download copy',
    retry: 'Try again',
    startNew: 'Start new',
    replaced: (n: number, kept: boolean) =>
      `${n} ${n === 1 ? 'machine no longer exists and is' : 'machines no longer exist and are'} shown as ${
        n === 1 ? 'a placeholder' : 'placeholders'
      }.${kept ? ' Your original is kept.' : ''}`,
  },

  // Mode switch
  modeMachine: 'Machine',
  modeSite: 'Template',
  modeLabel: 'Planner mode',

  site: {
    tooLargeForLink: 'This template is too large for a link. Download the JSON file instead.',
    panel: 'Template',
    name: 'Name',
    unnamed: 'Template',
    size: 'Size',
    width: 'Width (X)',
    depth: 'Depth (Z)',
    corridor: 'Corridor',
    sizeHint: (min: number, max: number) =>
      `Blocks, ${min} to ${max}. The template grows when a group is moved past an edge. Corridor: free blocks between groups.`,
    arrange: 'Arrange',
    arranged: 'Arranged along the flow.',
    arranging: 'Arranging…',
    optimizingPhase: 'Optimizing…',
    arrangeCancel: 'Cancel',
    arrangeStopped: 'Stopped; the template is unchanged.',
    neat: 'Neat',
    neatHint:
      'Arranges the template and routes neatly, mostly underground (neat routing, at least one layer deep). One undo step takes both back.',
    arrangeCancelled: (optimize: boolean) =>
      `Template edited: ${optimize ? 'optimizing' : 'arranging'} stopped.`,
    arrangeFailed: (msg: string) => `Arranging failed: ${msg}`,
    optimize: 'Optimize',
    optimizeHint:
      'Arrange, then search for a tighter layout with shorter pipes (simulated annealing) and keep it if the router agrees.',
    optimized: (from: number, to: number, reshaped: number) =>
      `Optimized: ${from} → ${to} pipe and cable blocks, tested with the router.` +
      (reshaped > 0 ? ` ${reshaped} ${reshaped === 1 ? 'group' : 'groups'} packed another way.` : ''),
    optimizedSame: 'Nothing found that beats the current layout; nothing changed.',
    optimizeTruncated: '(stopped at the time limit)',
    arrangedFloors: (n: number) => `Arranged along the flow, on ${n} floors.`,
    building: 'Laying out and routing…',
    needs: (w: number, d: number) => `Does not fit: needs ${w} × ${d}.`,
    importOpen: 'Import from GTNH Planner',
    /** The same action where the top bar has little room. */
    importShort: 'Import',
    groups: 'Groups',
    noGroups: 'No groups yet. Add one, or import a chain from GTNH Planner.',
    addGroup: 'Add multiblock',
    addSingle: 'Add single-block machine',
    addPlaceholder: 'Add placeholder',
    replace: 'Replace…',
    replaceWith: 'Replace with',
    replaceCatalog: 'Multiblock…',
    count: 'Count',
    x: 'X',
    z: 'Z',
    elevation: 'Height',
    rotate: 'Rotate',
    remove: 'Remove',
    removeGroup: 'Remove group',
    removed: (name: string) => `Removed ${name}.`,
    duplicate: 'Duplicate',
    duplicated: 'Duplicated.',
    frame: 'Frame',
    deselect: 'Deselect',
    label: 'Label',
    machine: 'Machine',
    packing: 'Packing',
    placement: 'Placement',
    grid: (x: number, y: number, z: number) => `${x} × ${y} × ${z}`,
    footprint: (w: number, d: number) => `${w} × ${d} blocks`,
    maxX: 'Max X',
    maxZ: 'Max Z',
    packingHint: 'Multiblocks along each axis. Empty = unlimited.',
    lockLimits: 'Keep these limits',
    lockLimitsHint:
      'Arrange and Optimize never change the limits of a group that is kept. Editing the limits keeps them.',
    hatches: 'Extra hatches',
    turn: 'Turn',
    turnLeft: 'Turn counter-clockwise',
    turnRight: 'Turn clockwise',
    rotation: (quarters: number) => `${quarters * 90}°`,
    nudge: 'Move the group',
    nudgeStep: (axis: string, sign: number) => `${sign > 0 ? '+' : '−'}${axis}`,
    nudgeDir: { up: 'Move away', down: 'Move closer', left: 'Move left', right: 'Move right' },
    raise: 'Raise one block (PageUp)',
    lower: 'Lower one block (PageDown)',
    placementHint:
      'Drag the selected group in the view, or use the arrows. PageUp and PageDown raise and lower it. X and Z are its corner in blocks.',
    undo: 'Undo',
    redo: 'Redo',
    undone: 'Undone.',
    redone: 'Redone.',
    nothingToUndo: 'Nothing to undo.',
    nothingToRedo: 'Nothing to redo.',
    addLinkOpen: 'Add link…',
    addLinkClose: 'Cancel',
    pipesWait: 'Pipes follow when you pause',
    hint: {
      title: 'Move the group',
      titlePort: 'Move the port',
      drag: 'Move (drag the group)',
      dragPort: 'Move (drag the port)',
      lift: 'Raise / lower 1 block',
      autoPort: 'Auto place',
      move: 'Move 1 block',
      fast: 'Move 5 blocks',
      rotate: 'Turn (Shift: back)',
      frame: 'Frame it',
      undo: 'Undo / redo',
      remove: 'Remove',
      deselect: 'Deselect',
      camera: 'Arrows follow the camera: ↑ always moves away from you.',
      open: 'Controls',
    },
    needed: (n: number) => `${n} needed`,
    links: 'Links',
    noLinks: 'No links yet.',
    addLink: 'Add link',
    from: 'From',
    to: 'To',
    resource: 'Resource',
    newResource: 'New…',
    resourceName: 'Resource name',
    kind: 'Kind',
    rate: 'Rate / s',
    inputPort: 'Template input',
    outputPort: 'Template output',
    kinds: { item: 'Item', fluid: 'Fluid', power: 'Power' } satisfies Record<ResourceKind, string>,
    problems: 'Problems',
    notes: 'Notes',
    routing: 'Routing',
    routingStyle: 'Style',
    routingStyles: { classic: 'Classic', neat: 'Neat' },
    routingDepth: 'Depth',
    routingDepthHint:
      'The most layers under the ground that pipes and cables may use. 0 keeps them on the ground.',
    routingDepthUsed: (asked: number, used: number) =>
      `Depth ${used} is in use: the template is too big to route ${asked} layers under the ground.`,
    routingLegacy: (depth: number) =>
      `This template has no routing of its own yet: it uses classic routing, ${depth === 0 ? 'on the ground' : `${depth} layer${depth === 1 ? '' : 's'} under the ground`}, following the Connect from below switch of the machine view. Choosing a style or depth here gives it its own routing.`,
    useNeat: 'Use neat routing',
    undergroundView: 'X-ray',
    undergroundViewHint: 'See through the ground and the machines to the pipes under them.',
    routeStats: (blocks: number, bends: number, underground: number) =>
      `${blocks} blocks routed, ${underground} under the ground, ${bends} ${bends === 1 ? 'bend' : 'bends'}.`,
    routeStatsLevels: (levels: number[]) =>
      `Under the ground by level: ${levels.map((n, i) => `−${i + 1}: ${n}`).join(', ')}.`,
    routeStatsSurface: (trunk: number, stubs: number) =>
      `On the ground: ${trunk} in trunk lines, ${stubs} in hatch stubs.`,
    tier: 'Tier',
    tierHint: 'Voltage tier of the energy hatches (a transformer: its high side).',
    tierAny: 'Any',
    resources: 'Resources',
    resourcesHint: 'Where the hatch of each resource goes. Auto spreads them over the units and zones.',
    unit: 'Unit',
    zone: 'Zone',
    auto: 'Auto',
    allUnits: 'All units',
    unitN: (n: number) => `Unit ${n}`,
    unitGone: (n: number) => `Unit ${n} (not in the group)`,
    noResources: 'No resources yet. Link this group to another, or to a port.',
    hatchTiers: 'Hatch tiers',
    pickedHatch: 'Selected hatch',
    hatchDetails: 'Details',
    hatchServes: (units: readonly number[]) =>
      units.length === 0
        ? 'Serves no unit of the group.'
        : `Serves ${units.length > 1 ? 'units' : 'unit'} ${units.join(', ')}.`,
    hatchZone: (name: string, text?: string) => `Zone ${name}${text ? `: ${text}` : ''}`,
    hatchTierShared: 'shared',
    hatchTierName: (kind: string, resource: string | undefined, unit: number | 'shared') =>
      `${kind}${resource ? ` ${resource}` : ''}${unit === 'shared' ? '' : ` · unit ${unit + 1}`}`,
    machineType: 'Machine type',
    machineTypeAny: 'Plain machine',
    machineSearch: 'Search machine types',
    machineNone: 'No machine type matches.',
    transformer: 'Transformer',
    step: 'Direction',
    stepDown: 'Step down',
    stepUp: 'Step up',
    amps: 'Amperage',
    ampsOption: (amps: number) => `${amps} A`,
    transformerReset: 'Transformer settings were reset.',
    ampsInvalid: (tier: string, amps: number) =>
      `GT has no ${amps} A transformer at ${tier}. Pick another amperage or tier.`,
    staleAssign: (n: number) =>
      `${n} ${n === 1 ? 'choice' : 'choices'} for resources this group no longer takes or gives.`,
    staleAssignClear: 'Clear',
    flow: 'Flow animation',
    animation: 'Animation',
    animationHint: 'Moving flow arrows on pipes and cables',
    icons: 'Item icons (gtnhplanner.com)',
    opened: 'Template opened.',
    reset: 'Reset template',
    resetDone: 'Template reset.',
    addToSite: 'Add to template',
    addedToSite: 'Added to the template.',
    sharedPrompt: 'Open shared template? It replaces your current one.',
    groupCount: (n: number) => `${n} ${n === 1 ? 'group' : 'groups'}`,
    connected: (c: number, total: number) => `${c}/${total} connected`,
    ports: 'Ports',
    portIn: 'In',
    portOut: 'Out',
    rateText: (rate: number, kind: ResourceKind) =>
      `${rate >= 100 ? Math.round(rate) : Math.round(rate * 100) / 100} ${kind === 'fluid' ? 'L/s' : kind === 'power' ? 'EU/t' : '/s'}`,
    netInfo: (name: string, blocks: number, connected: number, total: number) =>
      `${name}: ${blocks} blocks, ${connected}/${total} connected`,
    groupInfo: (name: string, units: number, source?: string) =>
      `${name} ×${units}${source ? ` (${source})` : ''}`,
    warning: (w: SiteWarning, name: (groupId: string) => string, res: (key: string) => string): string => {
      switch (w.type) {
        case 'error':
          return `${name(w.group)}: ${w.message}`;
        case 'overlap':
          return `${name(w.groups[0])} overlaps ${name(w.groups[1])}.`;
        case 'outside':
          return `${name(w.group)} is outside the template.`;
        case 'fewer':
          return `${name(w.group)}: placed ${w.placed} of ${w.requested}.`;
        case 'unplaced':
          return `${name(w.group)}: ${w.count} ${w.count === 1 ? 'hatch' : 'hatches'} could not be placed.`;
        case 'unsupported':
          return `${name(w.group)} cannot take ${res(w.resource)}.`;
        case 'missing':
          return `${name(w.group)}: no hatch for ${res(w.resource)} on ${w.units} ${w.units === 1 ? 'unit' : 'units'}.`;
        case 'unrouted':
          return `${res(w.resource)}: ${w.connected} of ${w.total} connected.`;
        case 'noport':
          return `No room on the edge for port ${w.port}.`;
        case 'powerTier':
          return `${name(w.group)}: ${res(w.resource)} carries ${w.expected}, but this machine takes only ${w.got}.`;
        case 'transformerInvalid':
          return `${name(w.group)}: GT has no ${w.amps} A transformer at ${w.tier}.`;
        case 'powerUnknownTier':
          return `${res(w.resource)}: its voltage is not known, so the transformers on it are not checked.`;
        case 'assignInactive':
          return `${name(w.group)}: ${res(w.resource)} is set to unit ${w.unit + 1}, but the group has no such unit.`;
        case 'capacity':
          return `${name(w.group)}: hatches don't fit, ${w.needed} wanted and ${w.fits} fit. Remove ${w.remove}.${w.mandatory ? ' Even the required hatches do not all fit.' : ''}${w.units > 1 ? ` (${w.units} units)` : ''}`;
        case 'hatch': {
          const what = HATCH_KIND_NAMES[w.kind].toLowerCase();
          const where = w.units === 1 ? '1 unit' : `${w.units} units`;
          const for_ = w.resources.length ? ` for ${w.resources.map(res).join(', ')}` : '';
          const region = w.region ? ` in ${w.region}` : '';
          return w.reason === 'required'
            ? `${name(w.group)}: a required ${what} hatch${region} is missing on ${where}.`
            : w.reason === 'max'
              ? `${name(w.group)}: the ${what} hatches are at their maximum; one more${for_} found no room on ${where}.`
              : w.reason === 'unsupported'
                ? `${name(w.group)} cannot take a ${what} hatch${for_}.`
                : w.reason === 'casings'
                  ? `${name(w.group)}: a ${what} hatch${for_} would leave too few casings on ${where}.`
                  : `${name(w.group)}: no place for a ${what} hatch${for_}${region} on ${where}.`;
        }
      }
    },
    note: (n: SiteNote, name: (groupId: string) => string, res: (key: string) => string): string => {
      switch (n.type) {
        case 'distributed':
          return `${name(n.group)}: ${n.resources.map(res).join(', ')} spread over the units, as a full set did not fit on every unit.`;
        case 'split':
          return `${name(n.group)}: ${res(n.resource)} could not share one hatch and got ${n.hatches}.`;
        case 'wallshare':
          return `${name(n.group)}: ${WALLSHARE_NAMES[n.wanted]} is not possible (${WALLSHARE_REASONS[n.reason]}); used ${WALLSHARE_NAMES[n.used].toLowerCase()}.`;
      }
    },
    problemCount: (n: number) => `${n} ${n === 1 ? 'problem' : 'problems'}`,
  },

  importer: {
    title: 'Import from GTNH Planner',
    hint: 'On the GTNH Planner board, use Export JSON. Open the file here or paste its text. Nothing is sent anywhere: the file is read in this browser.',
    paste: 'Paste JSON here',
    openFile: 'Open file',
    read: 'Read',
    build: 'Build template',
    building: 'Building…',
    cancel: 'Cancel',
    node: 'Recipe',
    machine: 'Machine',
    count: 'Count',
    placeAs: 'Place as',
    single: 'Single-block machine',
    placeholder: 'Placeholder',
    port: 'Template port (not placed)',
    skip: 'Skip',
    fit: 'Size the template to the chain',
    optimizeAfter: 'Optimize the layout after import',
    optimizeAfterHint:
      'Once the template is shown, searches a few seconds for a layout with shorter pipes. Undo brings the plain layout back.',
    fixedHint:
      'Keeps this size. What does not fit on the ground is built on floors above it, and big groups stack their machines up.',
    replaces: 'Replaces the current template.',
    skippedEntries: (n: number) => `${n} malformed ${n === 1 ? 'entry was' : 'entries were'} skipped.`,
    adjustedValues: (n: number) =>
      `${n} ${n === 1 ? 'value was' : 'values were'} out of range and ${n === 1 ? 'was' : 'were'} adjusted.`,
    done: (groups: number, ports: number, links: number) =>
      `Imported ${groups} groups, ${ports} ports and ${links} links.`,
    aspects: (n: number) => `${n} Thaumcraft ${n === 1 ? 'flow was' : 'flows were'} left out.`,
    placeholders: (names: string[]) => `Placeholders (not in the catalog yet): ${names.join(', ')}.`,
    truncated: 'The chain is larger than a template can hold; the rest was left out.',
    newerSchema: (v: number) =>
      `This file comes from a newer GTNH Planner (format ${v}). Check the result: new fields are not read.`,
    sized: (w: number, d: number) => `Template: ${w} × ${d}.`,
    floors: (n: number) => `Built on ${n} floors.`,
  },

  // Required blocks checklist
  bom: {
    toggle: 'Blocks',
    title: 'Required blocks',
    gathered: (done: number, total: number) => `${done} of ${total} gathered`,
    clear: 'Clear ticks',
    sort: (mode: SortMode) =>
      `Sort: ${{ grouped: 'by type', most: 'most first', fewest: 'fewest first' }[mode]}`,
    sortHint: 'Change the order of the list',
    blocks: 'Blocks',
    io: 'IO',
    anyTier: '(any tier)',
    ioOff: 'No pipes or cables shown. Turn on Pipes or Cables to list them.',
    empty: 'Nothing to build yet.',
    search: 'Search blocks',
    noMatches: 'No block matches.',
    tick: (name: string) => `Gathered: ${name}`,
    ioClass: {
      item: 'Item pipes',
      fluid: 'Fluid pipes',
      steam: 'Steam pipes',
      energy: 'Energy cables',
    } satisfies Record<IoClass, string>,
  },

  validity: {
    title: 'Buildability',
    forms: 'Will form',
    wontForm: (n: number) => `Won't form: ${n} ${n === 1 ? 'problem' : 'problems'}`,
    hints: 'Hints',
    unit: (n: number) => `Unit ${n}`,
    /** Per-group badge in the template view. */
    badge: "Won't form",
    badgeHint: 'GT would not form this machine as laid out. See Buildability below.',
    groupProblem: (name: string, n: number) =>
      `${name}: won't form, ${n} ${n === 1 ? 'problem' : 'problems'} (see its Buildability).`,
    glass: 'Glass',
    glassHint: 'Tier of the glass that limits the hatches. GT refuses to form when a hatch is above it.',
    glassDrawn: (tier: string) => `${tier} (drawn)`,
    /** What is wrong, without the unit; `casings` names the casing blocks GT counts. */
    text: (p: ValidityProblem, casings: string): string => {
      const kind = (k: HatchKind) => HATCH_KIND_NAMES[k].toLowerCase();
      switch (p.type) {
        case 'missingEnergy':
          return p.min > 1 ? `${p.have} of ${p.min} energy hatches` : 'no energy hatch';
        case 'missingMaintenance':
          return p.min > 1 ? `${p.have} of ${p.min} maintenance hatches` : 'no maintenance hatch';
        case 'hatchCount':
          return p.min !== undefined
            ? `${p.have} ${kind(p.kind)} ${p.have === 1 ? 'hatch' : 'hatches'}, GT needs ${p.min}`
            : `${p.have} ${kind(p.kind)} hatches, GT allows ${p.max}`;
        case 'requiredAny':
          return `${p.have} of ${p.min} needed hatches (${p.kinds.map(kind).join(' or ')})`;
        case 'casings':
          return `${casings} (${p.have} left after hatches, GT needs at least ${p.min})`;
        case 'forbiddenFace':
          return `${HATCH_KIND_NAMES[p.kind]} hatch faces ${FACE_NAMES[p.face]}, a side GT's auto-placement doesn't use (hint only; the machine still forms)`;
        case 'glassTier':
          return `${kind(p.kind)} hatch ${p.hatchTier} is above the glass (${p.glassTier})`;
      }
    },
  },

  hatchKinds: HATCH_KIND_NAMES,
};

export type Strings = typeof t;
