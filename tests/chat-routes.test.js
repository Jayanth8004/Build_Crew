import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../backend/routes/chatRoutes.js';
import ChatGroup from '../backend/models/ChatGroup.js';
import Team from '../backend/models/Team.js';
import Project from '../backend/models/Project.js';
import HackathonTeam from '../backend/models/HackathonTeam.js';
import User from '../backend/models/User.js';

const admin = '000000000000000000000001';
const teammate = '000000000000000000000002';
const outsider = '000000000000000000000003';
const groupId = '000000000000000000000004';
const teamId = '000000000000000000000005';
const group = { _id: groupId, admin, members: [admin], teamId };
const query = result => ({
  populate() { return this; }, select() { return this; },
  lean() { return Promise.resolve(result); },
});
const invoke = async (path, body, userId = admin) => {
  const layer = router.stack.find(layer => layer.route?.path === path && layer.route.methods.post);
  const events = [];
  const req = {
    params: { groupId }, body, user: { _id: userId, role: 'student', name: 'Builder' },
    app: { get: () => ({ to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) }) },
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await layer.route.stack.at(-1).handle(req, res);
  return { ...res, events };
};

function setup(t, project = { _id: teamId, createdBy: admin, members: [admin, teammate] }) {
  t.mock.method(ChatGroup, 'findById', () => query(group));
  t.mock.method(Team, 'findById', () => query(null));
  t.mock.method(Project, 'findById', () => query(project));
  t.mock.method(HackathonTeam, 'findById', () => query(null));
  t.mock.method(User, 'find', () => query([{ _id: admin }, { _id: teammate }]));
}

test('admin can add a newly joined teammate and both users receive the update', async t => {
  setup(t);
  t.mock.method(ChatGroup, 'findByIdAndUpdate', (id, update) => {
    assert.equal(id, groupId);
    assert.deepEqual(update.$addToSet.members.$each, [teammate]);
    return query({ ...group, members: [{ _id: admin }, { _id: teammate }] });
  });
  const result = await invoke('/groups/:groupId/members', { memberIds: [teammate] });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.events.map(event => event.room), [`user:${admin}`, `user:${teammate}`]);
});

test('adding someone outside the project is rejected without writing', async t => {
  setup(t);
  const write = t.mock.method(ChatGroup, 'findByIdAndUpdate', () => { throw new Error('Must not write'); });
  const result = await invoke('/groups/:groupId/members', { memberIds: [outsider] });
  assert.equal(result.statusCode, 400);
  assert.equal(write.mock.callCount(), 0);
});

test('a missing/deleted linked team fails closed when adding members', async t => {
  setup(t, null);
  const result = await invoke('/groups/:groupId/members', { memberIds: [teammate] });
  assert.equal(result.statusCode, 403);
});

test('non-members cannot add members or send messages', async t => {
  setup(t);
  assert.equal((await invoke('/groups/:groupId/members', { memberIds: [teammate] }, outsider)).statusCode, 403);
  assert.equal((await invoke('/groups/:groupId/messages', { text: 'hello' }, outsider)).statusCode, 403);
});

test('chat rejects empty text, media-only payloads, and oversized messages', async t => {
  setup(t);
  for (const body of [{ text: '  ' }, { file: 'video.mp4' }, { text: 'x'.repeat(1001) }]) {
    assert.equal((await invoke('/groups/:groupId/messages', body)).statusCode, 400);
  }
});
