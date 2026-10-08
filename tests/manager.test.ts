import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManagerPlan } from '../src/server/manager.js';

const allowed = new Set([12, 34]);
const task = { issue: 12, title: 'Fix login redirect', prompt: 'Trace and fix the redirect loop, then run the relevant tests.', rationale: 'This issue directly blocks the release goal.' };

test('manager parses a direct JSON proposal and keeps only the defined task fields', () => {
  assert.deepEqual(parseManagerPlan(JSON.stringify({ tasks: [task] }), allowed), [task]);
});

test('manager parses Claude structured output', () => {
  assert.deepEqual(parseManagerPlan(JSON.stringify({ structured_output: { tasks: [task] } }), allowed), [task]);
});

test('manager extracts the final Codex agent message from JSONL events', () => {
  const output = [
    JSON.stringify({ type: 'thread.started', thread_id: 'test' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ tasks: [task] }) } }),
  ].join('\n');
  assert.deepEqual(parseManagerPlan(output, allowed), [task]);
});

test('manager joins OpenCode text events before parsing the proposal', () => {
  const proposal = JSON.stringify({ tasks: [task] });
  const output = [
    JSON.stringify({ type: 'text', part: { text: proposal.slice(0, 20) } }),
    JSON.stringify({ type: 'text', part: { text: proposal.slice(20) } }),
    JSON.stringify({ type: 'step_finish', reason: 'stop' }),
  ].join('\n');
  assert.deepEqual(parseManagerPlan(output, allowed), [task]);
});

test('manager rejects tasks for unselected or repeated issues', () => {
  assert.throws(() => parseManagerPlan(JSON.stringify({ tasks: [{ ...task, issue: 99 }] }), allowed), /unselected/i);
  assert.throws(() => parseManagerPlan(JSON.stringify({ tasks: [task, task] }), allowed), /duplicate/i);
});

test('manager rejects incomplete and oversized task details', () => {
  assert.throws(() => parseManagerPlan(JSON.stringify({ tasks: [{ ...task, prompt: '' }] }), allowed), /incomplete/i);
  assert.throws(() => parseManagerPlan(JSON.stringify({ tasks: [{ ...task, title: 'x'.repeat(121) }] }), allowed), /incomplete/i);
});

test('manager rejects malformed model output', () => {
  assert.throws(() => parseManagerPlan('not JSON', allowed), /invalid plan/i);
  assert.throws(() => parseManagerPlan(JSON.stringify({ tasks: 'nope' }), allowed), /invalid plan/i);
});
