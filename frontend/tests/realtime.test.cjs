const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function runtime(fetch = () => new Promise(() => {})) {
  const timers = new Map();
  const intervals = new Map();
  const sockets = [];
  let nextTimer = 0;
  class Socket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    frame(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  }
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/realtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, {
    exports, WebSocket: Socket, AbortController, fetch, console: { warn() {} }, Date, Math,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++nextTimer; intervals.set(id, { fn, delay }); return id; },
    clearInterval: id => intervals.delete(id),
  });
  const client = new exports.RealtimeClient('http://localhost:8080');
  client.setActive(true);
  const callbacks = () => ({ readyCount: 0, updates: [], errors: [], ready() { this.readyCount++; }, update(frame) { this.updates.push(frame); }, error(code) { this.errors.push(code); } });
  function listener() { const record = callbacks(); return { record, ready: () => record.ready(), update: frame => record.update(frame), error: code => record.error(code) }; }
  return { client, sockets, timers, intervals, listener, exports,
    runTimer(delay) { const entry = [...timers].find(([, timer]) => delay === undefined || timer.delay === delay); assert.ok(entry, 'timer scheduled'); timers.delete(entry[0]); entry[1].fn(); },
  };
}

test('one connection multiplexes subscriptions and restores them after foregrounding', () => {
  const r = runtime();
  const roster = r.listener(), chat = r.listener();
  const stopRoster = r.client.subscribe('event_details', 'game', roster);
  const stopChat = r.client.subscribe('event_messages', 'game', chat);
  assert.equal(r.sockets.length, 1);
  const first = r.sockets[0]; first.open();
  assert.equal(first.sent.filter(frame => frame.type === 'subscribe').length, 2);
  first.frame({ type: 'subscribed', target_type: 'event_details', target_id: 'game' });
  assert.equal(roster.record.readyCount, 1);
  r.client.setActive(false);
  assert.equal(first.readyState, 3);
  assert.equal(r.intervals.size, 0);
  r.client.setActive(true);
  const second = r.sockets[1]; second.open();
  assert.equal(second.sent.filter(frame => frame.type === 'subscribe').length, 2);
  first.frame({ type: 'update', target_type: 'event_messages', target_id: 'game', sequence: '1' });
  assert.equal(chat.record.updates.length, 0, 'old connection frames ignored');
  stopRoster(); stopChat();
  assert.equal(second.readyState, 3);
  assert.equal(r.timers.size, 0);
});

test('failed upgrades fall back to long polling and HTTP permissions are enforced', async () => {
  const requests = [];
  const r = runtime(async (url, options) => {
    requests.push({ url, options });
    return { status: 403, ok: false };
  });
  const chat = r.listener();
  const stop = r.client.subscribe('event_messages', 'game', chat);
  r.sockets[0].close(); r.runTimer();
  r.sockets[1].close(); r.runTimer();
  r.sockets[2].close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.client.getStatus(), 'fallback');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/realtime\?target_type=event_messages&target_id=game/);
  assert.deepEqual(chat.record.errors, ['forbidden']);
  r.runTimer(60000); r.sockets[3].open();
  assert.equal(r.sockets[3].sent.filter(frame => frame.type === 'subscribe').length, 0, 'denied target stays revoked');
  stop();
});

test('large send buffers force reconnect and duplicate targets keep the remaining listener', () => {
  const r = runtime();
  const first = r.listener(), second = r.listener();
  const stopFirst = r.client.subscribe('event_details', 'game', first);
  r.sockets[0].open();
  const stopSecond = r.client.subscribe('event_details', 'game', second);
  stopFirst();
  r.sockets[0].frame({ type: 'update', target_type: 'event_details', target_id: 'game', sequence: '2', payload: {} });
  assert.equal(first.record.updates.length, 0);
  assert.equal(second.record.updates.length, 1);
  r.sockets[0].bufferedAmount = 70000;
  const heartbeat = [...r.intervals.values()][0]; heartbeat.fn();
  assert.equal(r.sockets[0].readyState, 3);
  assert.equal(r.client.getStatus(), 'reconnecting');
  stopSecond();
});

test('sequence comparison preserves bigint ordering beyond JavaScript number precision', () => {
  const r = runtime();
  assert.equal(r.exports.compareSequence('9007199254740993', '9007199254740992'), 1);
  assert.equal(r.exports.compareSequence('10', '9'), 1);
  assert.equal(r.exports.validSequence('1e10'), false);
  assert.equal(r.exports.validSequence('01'), false);
});
