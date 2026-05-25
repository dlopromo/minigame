const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function sameJson(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

function loadBrowserScripts(files) {
  const app = {
    Common: { escapeHtml: value => String(value || '') },
    GameManager: {
      games: {},
      register(game) { this.games[game.id] = game; }
    }
  };
  const context = {
    window: { App: app },
    App: app,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math
  };
  vm.createContext(context);
  files.forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
    context.App = context.window.App;
  });
  return context.window.App;
}

function testRoomSeating() {
  const App = loadBrowserScripts(['js/roomSeating.js']);
  const room = {
    members: {
      a: { name: 'A', online: true, joinedAt: 1 },
      b: { name: 'B', online: true, joinedAt: 2 },
      c: { name: 'C', online: true, joinedAt: 3 },
      d: { name: 'D', online: true, joinedAt: 4 },
      e: { name: 'E', online: true, joinedAt: 5 }
    },
    queue: {
      a: { name: 'A', queuedAt: 10 },
      b: { name: 'B', queuedAt: 20 },
      c: { name: 'C', queuedAt: 30 },
      d: { name: 'D', queuedAt: 40 },
      e: { name: 'E', queuedAt: 50 }
    }
  };
  const seating = App.RoomSeating.build(room, { minRoomPlayers: 2, maxPlayers: 3, aiFill: false });
  assert.strictEqual(seating.canStart, true);
  sameJson(seating.players.map(p => p.id), ['a', 'b', 'c']);
  sameJson(seating.waitingQueue.map(p => p.id), ['d', 'e']);
  sameJson(seating.spectators.map(p => p.id), ['d', 'e']);

  const aiSeating = App.RoomSeating.build({
    members: { a: { name: 'A', online: true, joinedAt: 1 } },
    queue: { a: { name: 'A', queuedAt: 10 } }
  }, { minRoomPlayers: 1, maxPlayers: 4, aiFill: true });
  assert.strictEqual(aiSeating.players.length, 4);
  assert.strictEqual(aiSeating.players.filter(p => p.isAI).length, 3);
}

function testStaleNameReclaim() {
  const App = loadBrowserScripts(['js/signaling.js']);
  const now = 1700000060001;
  const members = {
    old: {
      name: 'David',
      normalizedName: 'david',
      online: false,
      lastSeenAt: now - 61000
    },
    active: {
      name: 'Sharon',
      normalizedName: 'sharon',
      online: true,
      lastSeenAt: now
    }
  };
  assert.strictEqual(App.Signaling._test.hasDuplicateName(members, 'David', 'new-client', now), false);
  assert.strictEqual(App.Signaling._test.hasDuplicateName(members, 'sharon', 'new-client', now), true);
  const room = {
    members: {
      ghost: { name: 'Ghost', normalizedName: 'ghost', online: true, presence: 'playing', lastSeenAt: now - 70000 }
    }
  };
  App.Signaling._test.markStaleMembers(room, now);
  assert.strictEqual(room.members.ghost.online, false);
  assert.strictEqual(room.members.ghost.presence, 'spectating');
  const hostMembers = {
    a: { name: 'A', online: false, joinedAt: 1 },
    b: { name: 'B', online: true, joinedAt: 2 },
    c: { name: 'C', online: true, joinedAt: 3, presence: 'spectating' }
  };
  const candidate = App.Signaling._test.selectHostCandidate(hostMembers);
  assert.strictEqual(candidate.id, 'b');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(hostMembers.b, 'id'), false);
  const vote = {
    status: 'pending',
    expireAt: now + 30000,
    votes: {
      a: { agree: true },
      b: { agree: true },
      c: { agree: false }
    }
  };
  const decision = App.Signaling._test.voteDecision(vote, ['a', 'b', 'c'], now);
  assert.strictEqual(decision.done, true);
  assert.strictEqual(decision.status, 'accepted');
  const expired = App.Signaling._test.voteDecision({
    status: 'pending',
    expireAt: now - 1,
    votes: { a: { agree: true }, b: { agree: false } }
  }, ['a', 'b', 'c'], now);
  assert.strictEqual(expired.done, true);
  assert.strictEqual(expired.status, 'rejected');
}

function testBlackjackRules() {
  const App = loadBrowserScripts(['games/blackjack/blackjack.js']);
  const rules = App.BlackjackRules;
  assert.strictEqual(rules.handValue([{ rank: 'A' }, { rank: 'K' }]), 21);
  assert.strictEqual(rules.isBlackjack([{ rank: 'A' }, { rank: 'K' }]), true);
  assert.strictEqual(rules.handValue([{ rank: 'A' }, { rank: '9' }, { rank: 'A' }]), 21);
  assert.strictEqual(rules.handValue([{ rank: 'A' }, { rank: '9' }, { rank: '5' }]), 15);
  assert.strictEqual(rules.handValue([{ rank: 'K' }, { rank: '9' }, { rank: '5' }]), 24);
  const initial = rules.buildInitialState([
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' }
  ]);
  assert.strictEqual(initial.players.length, 2);
  assert.strictEqual(initial.players.every(p => p.hand.length === 2), true);
  assert.strictEqual(initial.dealer.hand.length, 2);
  assert.strictEqual(['playing', 'settled'].includes(initial.status), true);
  assert.strictEqual(typeof rules.phases.PLAYER_TURN, 'string');
  assert.strictEqual(['PLAYER_TURN', 'RESULT'].includes(initial.phase), true);
}

function test2048Rules() {
  const App = loadBrowserScripts(['games/tile2048/tile2048.js']);
  const rules = App.Tile2048Rules;
  const board = [
    [2, 2, 0, 0],
    [4, 0, 4, 0],
    [2, 4, 8, 16],
    [0, 0, 0, 0]
  ];
  const moved = rules.moveBoard(board, 'left');
  sameJson(moved.board[0], [4, 0, 0, 0]);
  sameJson(moved.board[1], [8, 0, 0, 0]);
  assert.strictEqual(moved.score, 12);
  assert.strictEqual(moved.moved, true);
  const blocked = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2]
  ];
  assert.strictEqual(rules.canMove(blocked), false);
  sameJson(rules.initialBoard(1234), rules.initialBoard(1234));
  const highTile = rules.moveBoard([
    [2048, 2048, 0, 0],
    [4096, 4096, 0, 0],
    [8192, 0, 8192, 0],
    [0, 0, 0, 0]
  ], 'left');
  sameJson(highTile.board[0], [4096, 0, 0, 0]);
  sameJson(highTile.board[1], [8192, 0, 0, 0]);
  sameJson(highTile.board[2], [16384, 0, 0, 0]);
  const initial = rules.buildInitialState([{ id: 'p1', name: 'P1' }], 99);
  assert.strictEqual(initial.players[0].undoStack.length, 0);
  assert.strictEqual(initial.status, 'playing');
}

function testColorShiftRules() {
  const App = loadBrowserScripts(['games/colorShift/colorShift.js']);
  const rules = App.ColorShiftRules;
  const top = rules.normalizeTop({ color: 'red', type: 'num', value: 5 });
  assert.strictEqual(rules.canPlay({ color: 'red', type: 'num', value: 2 }, top, 'red'), true);
  assert.strictEqual(rules.canPlay({ color: 'blue', type: 'num', value: 5 }, top, 'red'), true);
  assert.strictEqual(rules.canPlay({ color: 'blue', type: 'skip', value: 'skip' }, top, 'red'), false);
  assert.strictEqual(rules.canPlay({ color: 'wild', type: 'wild', value: 'wild' }, top, 'red'), true);
  const initial = rules.buildInitialState([
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' }
  ]);
  assert.strictEqual(initial.players.length, 2);
  assert.strictEqual(initial.players.every(p => p.hand.length === 7), true);
  assert.strictEqual(initial.discard.length, 1);
  assert.strictEqual(['red', 'blue', 'green', 'yellow'].includes(initial.activeColor), true);
}

function testSnapStackRules() {
  const App = loadBrowserScripts(['games/snapStack/snapStack.js']);
  const rules = App.SnapStackRules;
  assert.strictEqual(rules.isSnap([{ rank: 'A' }, { rank: 'A' }]), true);
  assert.strictEqual(rules.isSnap([{ rank: 'A' }, { rank: 'K' }]), false);
  const initial = rules.buildInitialState([
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' }
  ]);
  assert.strictEqual(initial.players.length, 2);
  assert.strictEqual(initial.deck.length, 52);
  assert.strictEqual(initial.pile.length, 0);
}

function testNineUpperRules() {
  const App = loadBrowserScripts(['games/nineUpper/nineUpper.js']);
  const rules = App.NineUpperRules;
  assert.strictEqual(typeof rules.promptFor(1), 'string');
  assert.strictEqual(rules.enabledQuestions().length >= 5, true);
  const initial = rules.buildInitialState([
    { id: 'p1', name: 'P1' },
    { id: 'p2', name: 'P2' },
    { id: 'p3', name: 'P3' }
  ]);
  assert.strictEqual(initial.players.length, 3);
  assert.strictEqual(initial.phase, 'submit');
  assert.strictEqual(initial.round, 1);
  assert.strictEqual(initial.maxRounds, 5);
  assert.strictEqual(typeof initial.questionId, 'string');
  assert.strictEqual(initial.playedQuestionIds.includes(initial.questionId), true);
  const seen = [];
  for (let round = 1; round <= rules.enabledQuestions().length; round += 1) {
    const picked = rules.pickQuestion(seen, seen[seen.length - 1] || '', round, 1);
    assert.strictEqual(seen.includes(picked.questionId), false);
    seen.splice(0, seen.length, ...picked.playedQuestionIds);
  }
  const cycled = rules.pickQuestion(seen, seen[seen.length - 1], seen.length + 1, 1);
  assert.strictEqual(cycled.questionCycle, 2);
  assert.strictEqual(cycled.playedQuestionIds.length, 1);
}

testRoomSeating();
testStaleNameReclaim();
testBlackjackRules();
test2048Rules();
testColorShiftRules();
testSnapStackRules();
testNineUpperRules();
console.log('All minigame MVP tests passed');
