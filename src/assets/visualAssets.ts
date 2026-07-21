export const visualAssets = {
  backgrounds: {
    operationsGrid: '/assets/backgrounds/malacca-operations-grid.svg',
  },
} as const;

export const backgroundCanvas = {
  width: 1535,
  height: 1024,
  aspectRatio: 1535 / 1024,
} as const;

export const referenceCanvas = {
  width: 1536,
  height: 1024,
  aspectRatio: 1536 / 1024,
} as const;

export const referenceZones = {
  topBar: {
    x: 0,
    y: 0,
    width: 1536,
    height: 64,
  },
  leftRail: {
    x: 0,
    y: 64,
    width: 256,
    height: 842,
  },
  rightRail: {
    x: 1240,
    y: 64,
    width: 296,
    height: 842,
  },
  centerMap: {
    x: 256,
    y: 64,
    width: 984,
    height: 842,
  },
  bottomControl: {
    x: 0,
    y: 906,
    width: 1536,
    height: 118,
  },
} as const;
