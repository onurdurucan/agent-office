import type { ManagerPlanItem, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { providerPicker } from './provider';

const MAX_ISSUES = 12;
const pending = new Map<string, (msg: Extract<ServerMsg, { t: 'manager.plan' }>) => void>();

export function routeManagerMessage(msg: ServerMsg) {
  if (msg.t !== 'manager.plan') return;
  pending.get(msg.requestId)?.(msg);
}

export function openManager(net: Net) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const goal = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'What should this project achieve? e.g. Prepare the next release by fixing high-priority bugs.', 'aria-label': 'Project goal' }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'manager-provider', 'Manager provider', 'agent-office.manager-provider');
  const status = h('p.note.manager-status');
  const issueList = h('div.manager-issues');
  const planList = h('div.manager-plan');
  const cancel = h('button.btn.hidden', { type: 'button', disabled: true }, 'Cancel planning') as HTMLButtonElement;
  const makePlan = h('button.btn.primary', { type: 'button' }, '🧭 Prepare plan') as HTMLButtonElement;
  const approve = h('button.btn.primary', { type: 'button', disabled: true }, 'Approve selected tasks') as HTMLButtonElement;
  const body = h(
    'div.body.manager',
    {},
    h('p.note', {}, 'The manager reviews only the issues you select and proposes one task per relevant issue. Nothing starts until you approve tasks; approved tasks use the existing queue and worker limit. Manager calls use the selected CLI account/model and are not included in the Office worker budget.'),
    h('label', { for: 'manager-goal' }, 'Project goal'),
    goal,
    provider.element,
    h('div.manager-issue-heading', {}, h('h3', {}, 'Open issues'), h('small', {}, 'Select up to 12')),
    issueList,
    status,
    planList,
  );
  goal.id = 'manager-goal';
  const el = h(
    'div.modal.manager-window',
    { role: 'dialog', 'aria-label': 'Project manager' },
    h('header', {}, h('h2', {}, '🧭 Project manager'), close),
    body,
    h('footer', {}, h('span.grow', {}, 'Review proposals before they reach the worker queue.'), cancel, approve, makePlan),
  );
  const selected = new Set<number>();
  const approved = new Set<number>();
  let proposals: ManagerPlanItem[] = [];
  const selectedProposals = new Set<number>();
  let activeRequest: string | undefined;
  let planProvider = provider.value();
  let planModel: string | undefined;

  const queuedIssue = (number: number) => store.queue.tasks.some((task) => task.issue === number && task.status !== 'done');
  const availableIssues = () => store.issues.items.filter((issue) => issue.state === 'OPEN' && !queuedIssue(issue.number));
  const renderIssues = () => {
    const allIssues = availableIssues();
    for (const number of selected) if (!allIssues.some((issue) => issue.number === number)) selected.delete(number);
    const issues = allIssues.slice(0, 60);
    issueList.replaceChildren(
      ...issues.map((issue) => {
        const checkbox = h('input', { type: 'checkbox', value: issue.number, checked: selected.has(issue.number), disabled: !selected.has(issue.number) && selected.size >= MAX_ISSUES }) as HTMLInputElement;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(issue.number);
          else selected.delete(issue.number);
          renderIssues();
          updateButtons();
        });
        return h(
          'label.manager-issue',
          {},
          checkbox,
          h('span', {}, `#${issue.number} ${issue.title}`),
          h('small', {}, issue.labels.slice(0, 3).map((label) => label.name).join(' · ')),
        );
      }),
    );
    if (!issues.length) issueList.append(h('p.note', {}, store.issues.loading ? 'Loading GitHub issues…' : store.issues.error ? `Could not load issues: ${store.issues.error}` : 'No unqueued open issues found. Check GitHub access or refresh the issues board.'));
  };

  const renderPlan = () => {
    const children: HTMLElement[] = [];
    if (proposals.length) children.push(h('h3', {}, 'Proposed work', h('small', {}, 'The plan is not queued until you approve it.')));
    children.push(...proposals.map((item) => {
      const alreadyQueued = queuedIssue(item.issue);
      const check = h('input', {
        type: 'checkbox',
        id: `manager-task-${item.issue}`,
        'aria-label': `Approve issue #${item.issue}: ${item.title}`,
        checked: selectedProposals.has(item.issue) && !approved.has(item.issue) && !alreadyQueued,
        disabled: approved.has(item.issue) || alreadyQueued,
      }) as HTMLInputElement;
      check.addEventListener('change', () => {
        if (check.checked) selectedProposals.add(item.issue);
        else selectedProposals.delete(item.issue);
        updateButtons();
      });
      const issue = store.issues.items.find((entry) => entry.number === item.issue);
      return h(
        'div.manager-proposal',
        {},
        check,
        h('div.manager-proposal-main', {},
          h('label', { for: check.id }, h('strong', {}, `#${item.issue} ${item.title}`)),
          h('p', {}, item.rationale),
          h('details', {}, h('summary', {}, 'Worker task details'), h('p', {}, item.prompt)),
          alreadyQueued ? h('small', {}, 'Already on the queue') : approved.has(item.issue) ? h('small', {}, 'Approved and sent to the queue') : null,
          issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, 'View issue ↗') : null,
        ),
      );
    }));
    planList.replaceChildren(...children);
    updateButtons();
  };

  const updateButtons = () => {
    const checks = [...planList.querySelectorAll<HTMLInputElement>('.manager-proposal input[type=checkbox]')];
    approve.disabled = activeRequest !== undefined || !checks.some((check) => check.checked);
    makePlan.disabled = activeRequest !== undefined || selected.size === 0 || store.issues.loading;
    makePlan.textContent = activeRequest ? '⏳ Preparing…' : '🧭 Prepare plan';
    cancel.disabled = activeRequest === undefined;
    cancel.classList.toggle('hidden', activeRequest === undefined);
  };

  const requestPlan = () => {
    const cleanGoal = goal.value.trim();
    if (!cleanGoal) {
      goal.focus();
      status.textContent = 'Enter a project goal first.';
      return;
    }
    if (!provider.valid()) return;
    if (!selected.size) {
      status.textContent = 'Select at least one open issue.';
      return;
    }
    if (provider.value() === 'custom') {
      status.textContent = 'Choose Claude Code, OpenCode, or Codex for the manager.';
      return;
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    planProvider = provider.value();
    planModel = provider.model();
    activeRequest = requestId;
    proposals = [];
    selectedProposals.clear();
    approved.clear();
    status.textContent = 'The manager is reviewing the selected issues with the chosen coding CLI…';
    planList.replaceChildren();
    pending.set(requestId, (msg) => {
      if (activeRequest !== requestId) return;
      pending.delete(requestId);
      activeRequest = undefined;
      if (msg.error) {
        status.textContent = msg.error;
      } else {
        proposals = msg.tasks ?? [];
        for (const item of proposals) selectedProposals.add(item.issue);
        status.textContent = proposals.length ? 'Review the suggestions, then approve the tasks you want to add to the queue.' : 'No tasks were proposed.';
      }
      renderPlan();
      updateButtons();
    });
    net.send({
      t: 'manager.plan',
      requestId,
      goal: cleanGoal,
      issues: [...selected],
      provider: planProvider,
      model: planModel,
    });
    updateButtons();
  };

  const approveSelected = () => {
    for (const item of proposals) {
      if (!selectedProposals.has(item.issue) || queuedIssue(item.issue) || approved.has(item.issue)) continue;
      net.send({ t: 'queue.add', prompt: item.prompt, title: item.title, issue: item.issue, provider: planProvider, model: planModel });
      approved.add(item.issue);
    }
    status.textContent = 'Approved tasks were sent to the queue. Workers start according to the queue’s worker limit.';
    renderPlan();
  };

  cancel.addEventListener('click', () => {
    if (!activeRequest) return;
    net.send({ t: 'manager.cancel', requestId: activeRequest });
    cancel.disabled = true;
    status.textContent = 'Cancelling manager request…';
  });
  makePlan.addEventListener('click', requestPlan);
  approve.addEventListener('click', approveSelected);
  const unsubs = [store.on('issues', renderIssues), store.on('queue', () => { renderIssues(); renderPlan(); })];
  const modal = openModal(el, {
    onClose: () => {
      for (const unsubscribe of unsubs) unsubscribe();
      if (activeRequest) {
        net.send({ t: 'manager.cancel', requestId: activeRequest });
        pending.delete(activeRequest);
      }
    },
  });
  close.addEventListener('click', () => modal.close());
  renderIssues();
  renderPlan();
}
