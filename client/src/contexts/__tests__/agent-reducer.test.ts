import { describe, it, expect } from 'vitest';
import {
  agentReducer,
  initialAgentState,
  extractText,
  mapMessageView,
  mapPlan,
  mapPlanTodosToSteps,
  buildPlanFlowFromMessages,
  insertFileNode,
  removeFileNode,
  type AgentChatMessage,
  type AgentState
} from '../agent-reducer';
import type { AgentMessageView } from '@/api/server/agent';
import type { AgentFileNode, AgentPlanStep } from '@/components/agent/types';

describe('agent-reducer mappers', () => {
  it('extractText handles strings and content parts', () => {
    expect(extractText('hello')).toBe('hello');
    expect(
      extractText([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'x' } },
        { type: 'text', text: 'b' }
      ])
    ).toBe('ab');
    expect(extractText(undefined)).toBe('');
  });

  it('mapMessageView maps tool calls and tool results', () => {
    const assistant: AgentMessageView = {
      id: 'm1',
      role: 'assistant',
      source: 'assistant',
      data: {
        role: 'assistant',
        content: 'working',
        reasoning: 'think',
        tool_calls: [
          {
            id: 't1',
            function: { name: 'bash', arguments: '{"command":"ls"}' }
          }
        ]
      },
      plan: null,
      createdAt: null
    };
    const mapped = mapMessageView(assistant);
    expect(mapped.role).toBe('assistant');
    expect(mapped.content).toBe('working');
    expect(mapped.thinking).toBe('think');
    expect(mapped.toolCalls).toEqual([
      { id: 't1', name: 'bash', args: '{"command":"ls"}' }
    ]);

    const toolMsg: AgentMessageView = {
      id: 'm2',
      role: 'tool',
      source: 'assistant',
      data: { role: 'tool', content: 'result', tool_call_id: 't1' },
      plan: null,
      createdAt: null
    };
    const mappedTool = mapMessageView(toolMsg);
    expect(mappedTool.role).toBe('tool');
    expect(mappedTool.toolResult).toEqual({
      toolCallId: 't1',
      content: 'result'
    });
  });

  it('mapMessageView omits blank reasoning', () => {
    const assistant: AgentMessageView = {
      id: 'm1',
      role: 'assistant',
      source: 'assistant',
      data: {
        role: 'assistant',
        content: 'done',
        reasoning: ' \n\t '
      },
      plan: null,
      createdAt: null
    };

    expect(mapMessageView(assistant).thinking).toBeUndefined();
  });

  it('mapPlan maps todos to step statuses', () => {
    const plan = mapPlan({
      summary: null,
      todos: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'in_progress' }
      ],
      status: 'running'
    });
    expect(plan.status).toBe('running');
    expect(plan.steps.map(s => s.status)).toEqual(['done', 'running']);
  });

  it('mapPlanTodosToSteps hides internal manifest steps', () => {
    const steps = mapPlanTodosToSteps([
      { text: 'Implement UI', status: 'completed' },
      { text: 'Record .tenjo/dev-servers.json', status: 'in_progress' }
    ]);

    expect(steps).toEqual([
      { id: 's0', title: 'Implement UI', status: 'done' }
    ]);
  });

  it('rebuilds the per-step flow from persisted message plan snapshots', () => {
    const steps = (done: number): AgentPlanStep[] =>
      ['a', 'b', 'c'].map((title, index) => ({
        id: `s${index}`,
        title,
        status: index < done ? 'done' : 'pending'
      }));
    const msg = (id: string, done: number): AgentChatMessage => ({
      id,
      role: 'assistant',
      content: '',
      plan: { id: 'plan', status: 'running', steps: steps(done) }
    });
    // Two messages report the same done count (a repeat) — only growth flows.
    const flow = buildPlanFlowFromMessages([
      msg('m1', 1),
      { id: 'm2', role: 'tool', content: 'r' },
      msg('m3', 1),
      msg('m4', 2),
      msg('m5', 3)
    ]);
    expect(flow.map(e => e.afterMessageId)).toEqual(['m1', 'm4', 'm5']);
    expect(flow[0].plan.steps.map(s => s.status)).toEqual([
      'done',
      'pending',
      'pending'
    ]);
    expect(flow[2].plan.status).toBe('done');
  });
});

describe('agent-reducer file tree', () => {
  const tree: AgentFileNode[] = [
    {
      id: 'src',
      name: 'src',
      type: 'folder',
      updatedAtLabel: '',
      children: [
        { id: 'src/a.ts', name: 'a.ts', type: 'file', updatedAtLabel: '' }
      ]
    }
  ];

  it('inserts a nested file, creating folders', () => {
    const next = insertFileNode(tree, 'src/sub/b.ts');
    const sub = next[0].children?.find(n => n.id === 'src/sub');
    expect(sub?.type).toBe('folder');
    expect(sub?.children?.[0].id).toBe('src/sub/b.ts');
  });

  it('removes a file by id', () => {
    const next = removeFileNode(tree, 'src/a.ts');
    expect(next[0].children).toHaveLength(0);
  });
});

describe('agentReducer transitions', () => {
  it('accumulates streaming chunks and message-added clears them', () => {
    let state: AgentState = initialAgentState;
    state = agentReducer(state, { type: 'chunk', text: 'he' });
    state = agentReducer(state, { type: 'chunk', text: 'llo' });
    expect(state.streaming?.content).toBe('hello');
    state = agentReducer(state, {
      type: 'message-added',
      message: { id: 'm1', role: 'assistant', content: 'hello' }
    });
    expect(state.streaming).toBeNull();
    expect(state.messages).toHaveLength(1);
  });

  it('ignores blank thinking before visible streaming output exists', () => {
    let state: AgentState = initialAgentState;
    state = agentReducer(state, { type: 'thinking', text: '' });
    state = agentReducer(state, { type: 'thinking', text: ' \n\t ' });
    expect(state.streaming).toBeNull();

    state = agentReducer(state, { type: 'thinking', text: 'visible' });
    state = agentReducer(state, { type: 'thinking', text: '\n' });
    expect(state.streaming?.thinking).toBe('visible\n');
  });

  it('applies file-changed highlights and highlight-end removes deleted nodes', () => {
    let state: AgentState = {
      ...initialAgentState,
      fileTree: [{ id: 'a.ts', name: 'a.ts', type: 'file', updatedAtLabel: '' }]
    };
    state = agentReducer(state, {
      type: 'file-changed',
      changes: [
        { path: 'a.ts', kind: 'deleted' },
        { path: 'b.ts', kind: 'added' }
      ]
    });
    expect(state.highlights['a.ts']).toBe('deleted');
    expect(state.highlights['b.ts']).toBe('added');
    expect(state.fileTree.some(n => n.id === 'b.ts')).toBe(true);

    state = agentReducer(state, { type: 'highlight-end', id: 'a.ts' });
    expect(state.highlights['a.ts']).toBeUndefined();
    expect(state.fileTree.some(n => n.id === 'a.ts')).toBe(false);
  });

  it('builds a plan from plan-presented and switches mode on approval', () => {
    let state = agentReducer(initialAgentState, {
      type: 'plan-presented',
      steps: ['one', 'two']
    });
    expect(state.plan?.status).toBe('proposed');
    expect(state.plan?.steps).toHaveLength(2);
    state = agentReducer(state, { type: 'plan-resolved', approved: true });
    expect(state.mode).toBe('steer');
    expect(state.plan?.status).toBe('running');
  });

  it('stores the project-locked model', () => {
    const state = agentReducer(initialAgentState, {
      type: 'project-model',
      agentModel: {
        id: 'model-1',
        provider: 'openai',
        model: 'gpt-4.1',
        baseUrl: 'https://api.openai.com'
      }
    });

    expect(state.agentModel?.model).toBe('gpt-4.1');
  });

  it('tracks preview repair locking separately from launch errors', () => {
    let state = agentReducer(initialAgentState, {
      type: 'preview-launch-error',
      message: 'crashed'
    });
    expect(state.previewLaunchError).toBe('crashed');
    expect(state.previewRepairActive).toBe(false);

    state = agentReducer(state, { type: 'preview-repair-start' });
    expect(state.previewLaunchError).toBeNull();
    expect(state.previewRepairActive).toBe(true);

    state = agentReducer(state, { type: 'preview-repair-end' });
    expect(state.previewRepairActive).toBe(false);
  });
});
