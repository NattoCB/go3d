import assert from 'node:assert/strict';
import {pointIndex, indexPoint, neighbors, groupInfo} from '../static/view-model.mjs';

assert.equal(pointIndex([1,2,1], 3), 16, 'x is the fastest storage axis');
assert.deepEqual(indexPoint(16, 3), [1,2,1]);
assert.equal(neighbors([1,1,1], 3).length, 6, 'an interior point has six orthogonal neighbors');
assert.equal(neighbors([0,0,0], 3).length, 3, 'a corner has three neighbors, without wrapping');
assert.deepEqual(new Set(neighbors([0,0,0],3).map(p => p.join(','))), new Set(['1,0,0','0,1,0','0,0,1']));

const board = Array(27).fill(0);
board[pointIndex([1,1,1],3)] = 1;
board[pointIndex([1,1,2],3)] = 1;
const crossLayer = groupInfo(board,3,[1,1,1]);
assert.equal(crossLayer.stones.size, 2, 'same-color stones connect through z');
assert.equal(crossLayer.liberties.size, 9, 'the entire cross-layer group shares its distinct liberties');
board[pointIndex([0,1,1],3)] = 2;
assert.equal(groupInfo(board,3,[1,1,2]).liberties.size, 8, 'an enemy stone removes a liberty across the group');
board[pointIndex([2,1,2],3)] = 1;
const bentGroup = groupInfo(board,3,[1,1,1]);
assert.equal(bentGroup.stones.size, 3);
assert.equal(bentGroup.liberties.size, 9, 'one empty point adjacent to multiple group stones counts only once');
assert(bentGroup.liberties.has(pointIndex([2,1,1],3)), 'a shared cross-layer empty point remains a liberty');
assert.equal(groupInfo(board,3,[0,0,0]).stones.size, 0, 'empty points are not stone groups');

for (const n of [3,5,7]) {
  for (let index = 0; index < n ** 3; index += 1) {
    const point = indexPoint(index,n);
    assert.equal(pointIndex(point,n),index, `round trip ${n}: ${index}`);
    for (const adjacent of neighbors(point,n)) {
      assert.equal(adjacent.reduce((sum,value,axis) => sum + Math.abs(value-point[axis]),0),1);
      assert(adjacent.every(value => value >= 0 && value < n));
    }
  }
}
console.log('3D view-model behavior passed: coordinate identity, orthogonal boundaries, cross-layer groups and distinct liberties.');
