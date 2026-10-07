import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages, subscribeChat } from '../src/utils/chatSync.js';

const message = (id, seconds) => ({ _id: id, createdAt: new Date(seconds * 1000).toISOString() });

test('HTTP history does not erase a concurrent socket message; overlapping events deduplicate', () => {
  const live = message('live', 3);
  const history = [message('old', 1), message('middle', 2)];
  const result = mergeMessages([live], history);
  assert.deepEqual(result.map(m => m._id), ['old', 'middle', 'live']);
  assert.equal(mergeMessages(result, [live]).length, 3);
});

test('server echo replaces only the matching sender’s pending message', () => {
  const pending = { ...message('pending-1', 1), pending: true, clientMessageId: '1', senderId: { _id: 'alice' } };
  const saved = { ...message('saved', 2), clientMessageId: '1', senderId: { _id: 'alice' } };
  assert.deepEqual(mergeMessages([pending], [saved]), [saved]);
  assert.equal(mergeMessages([pending], [{ ...saved, senderId: { _id: 'bob' } }]).length, 2);
});

test('bounded history keeps newest 500 messages in chronological order', () => {
  const result = mergeMessages([], Array.from({ length: 600 }, (_, i) => message(String(i), i)));
  assert.equal(result.length, 500);
  assert.equal(result[0]._id, '100');
  assert.equal(result.at(-1)._id, '599');
});

test('reconnect rejoins room, recovers history, and cleanup ignores in-flight responses', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  const handlers = new Map();
  const emissions = [];
  let resolveLoad;
  let loads = 0;
  let deliveries = 0;
  const socket = {
    connected: false,
    on: (event, handler) => handlers.set(event, handler),
    off: event => handlers.delete(event),
    emit: (event, payload, ack) => { emissions.push([event, payload]); ack?.({ success: true }); },
  };
  const stop = subscribeChat({
    socket, kind: 'group', id: 'group-1',
    load: () => { loads++; return new Promise(resolve => { resolveLoad = resolve; }); },
    onData: () => { deliveries++; },
  });
  try {
    assert.equal(loads, 1);
    socket.connected = true;
    handlers.get('connect')();
    assert.deepEqual(emissions[0], ['join_group', { groupId: 'group-1' }]);
    assert.equal(loads, 1, 'no overlapping fetch on connect');
    resolveLoad({ messages: [message('first', 1)] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deliveries, 1);
    handlers.get('connect')();
    assert.equal(loads, 2);
    stop();
    resolveLoad({ messages: [message('late', 2)] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deliveries, 1);
    assert.equal(handlers.size, 0);
    assert.deepEqual(emissions.at(-1), ['leave_group', { groupId: 'group-1' }]);
  } finally {
    stop();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('without sockets, new messages are fetched automatically after two seconds', async t => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const socket = { connected: false, on() {}, off() {}, emit() {} };
  const stop = subscribeChat({
    socket, kind: 'team', id: 'team-1',
    load: async () => { loads++; return { messages: [] }; },
    onData() {},
  });
  try {
    await Promise.resolve();
    assert.equal(loads, 1);
    t.mock.timers.tick(1999);
    assert.equal(loads, 1);
    t.mock.timers.tick(1);
    assert.equal(loads, 2);
    await Promise.resolve();
    stop();
    t.mock.timers.tick(10000);
    assert.equal(loads, 2);
  } finally {
    stop();
    t.mock.timers.reset();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
