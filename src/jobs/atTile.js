/**
 * Job kinds that meaningfully target a tile (i, j) — i.e. the kinds that the
 * player can "prioritize" by right-clicking on a specific spot. Excludes
 * wander/move/eat (player-directed or no tile anchor).
 */
export const JOB_KINDS_AT_TILE = /** @type {ReadonlySet<string>} */ (
  new Set([
    'chop',
    'mine',
    'cut',
    'build',
    'deconstruct',
    'till',
    'plant',
    'harvest',
    'haul',
    'deliver',
    'supply',
  ])
);

/**
 * Human-readable label for a prioritize menu entry. Kept lowercase to match
 * the "prioritize chop" phrasing the menu uses.
 * @param {string} kind
 */
export function jobVerbForPrioritize(kind) {
  switch (kind) {
    case 'chop':
      return 'chop';
    case 'mine':
      return 'mine';
    case 'cut':
      return 'cut';
    case 'build':
      return 'build';
    case 'deconstruct':
      return 'demolish';
    case 'till':
      return 'till';
    case 'plant':
      return 'plant';
    case 'harvest':
      return 'harvest';
    case 'haul':
      return 'haul';
    case 'deliver':
      return 'deliver';
    case 'supply':
      return 'supply';
    default:
      return kind;
  }
}
