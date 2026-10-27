/** Convert an xyz point to the engine's x-fast flat board index. */
export const pointIndex = (point, size) => (point[2] * size + point[1]) * size + point[0];

/** Recover the stable xyz identity independently of camera or layer selection. */
export const indexPoint = (index, size) => [index % size, Math.floor(index / size) % size, Math.floor(index / (size * size))];

/** Return only finite-grid orthogonal neighbors; diagonals and wrapping are excluded. */
export function neighbors(point, size) {
  const result = [];
  for (let axis = 0; axis < 3; axis += 1) {
    for (const step of [-1, 1]) {
      if (point[axis] + step >= 0 && point[axis] + step < size) {
        const next = [...point]; next[axis] += step; result.push(next);
      }
    }
  }
  return result;
}

/** Read a display-only connected group and its distinct liberties across all layers. */
export function groupInfo(board, size, point) {
  const start = pointIndex(point, size), color = board[start];
  const stones = new Set(), liberties = new Set();
  if (!color) return {stones, liberties};
  const pending = [start]; stones.add(start);
  while (pending.length) {
    for (const next of neighbors(indexPoint(pending.pop(), size), size)) {
      const index = pointIndex(next, size);
      if (!board[index]) liberties.add(index);
      else if (board[index] === color && !stones.has(index)) { stones.add(index); pending.push(index); }
    }
  }
  return {stones, liberties};
}
