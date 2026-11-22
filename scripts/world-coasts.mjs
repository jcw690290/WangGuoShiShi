// Classify ocean-facing states in the map's original planar coordinates.
export function oceanCoasts(features, width, height, seaSeeds) {
  const scale = 4;
  const columns = width * scale;
  const rows = height * scale;
  const land = new Uint16Array(columns * rows);
  const queue = new Uint32Array(land.length);
  const contacts = new Uint32Array(features.length + 1);

  // Scanline fill uses even–odd parity across each polygon's outer ring and holes.
  for (const [index, { geometry }] of features.entries()) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons) {
      const crossings = new Map();
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++) {
          const [x, y] = ring[i - 1];
          const [u, v] = ring[i];
          const start = Math.max(0, Math.ceil(Math.min(y, v) * scale - 0.5));
          const end = Math.min(rows, Math.ceil(Math.max(y, v) * scale - 0.5));
          for (let row = start; row < end; row++) {
            const crossing = x + ((row + 0.5) / scale - y) * (u - x) / (v - y);
            if (!crossings.has(row)) crossings.set(row, []);
            crossings.get(row).push(crossing);
          }
        }
      }
      for (const [row, xs] of crossings) {
        xs.sort((a, b) => a - b);
        for (let i = 0; i < xs.length; i += 2) {
          const left = Math.max(0, Math.ceil(xs[i] * scale - 0.5));
          const right = Math.min(columns, Math.ceil(xs[i + 1] * scale - 0.5));
          if (left < right) land.fill(index + 1, row * columns + left, row * columns + right);
        }
      }
    }
  }

  function visitNeighbors(cell, visit) {
    const column = cell % columns;
    if (column > 0) visit(cell - 1);
    if (column < columns - 1) visit(cell + 1);
    if (cell >= columns) visit(cell - columns);
    if (cell < land.length - columns) visit(cell + columns);
  }

  // Grow land by one grid cell to seal narrow slivers between state outlines.
  // Each added cell inherits the nearest original state's ID.
  let tail = 0;
  for (let cell = 0; cell < land.length; cell++) {
    if (land[cell]) queue[tail++] = cell;
  }
  for (let i = 0; i < tail; i++) {
    const cell = queue[i];
    visitNeighbors(cell, (neighbor) => {
      if (!land[neighbor]) land[neighbor] = land[cell];
    });
  }

  // Flood from the map perimeter and known seas whose straits may be sealed.
  const ocean = new Uint8Array(land.length);
  let head = 0;
  tail = 0;
  function enqueueWater(cell) {
    if (land[cell] || ocean[cell]) return;
    ocean[cell] = 1;
    queue[tail++] = cell;
  }
  for (let column = 0; column < columns; column++) {
    enqueueWater(column);
    enqueueWater((rows - 1) * columns + column);
  }
  for (let row = 0; row < rows; row++) {
    enqueueWater(row * columns);
    enqueueWater(row * columns + columns - 1);
  }
  for (const [name, x, y] of seaSeeds) {
    const cell = Math.floor(y * scale) * columns + Math.floor(x * scale);
    if (land[cell]) throw new Error(`Water seed for ${name} is on land`);
    enqueueWater(cell);
  }
  function countContact(neighbor) {
    if (land[neighbor]) contacts[land[neighbor]]++;
    else enqueueWater(neighbor);
  }
  while (head < tail) visitNeighbors(queue[head++], countContact);

  // Require at least half a source pixel of contact with ocean water.
  return new Set(features.filter((_, index) => contacts[index + 1] >= scale / 2).map((f) => f.properties.id));
}
