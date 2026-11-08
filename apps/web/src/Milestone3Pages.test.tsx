import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalsPage } from './ApprovalsPage';
import { createWorkflowNode, pollingIntervalForStatus } from './WorkflowEditor';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
describe('Milestone 3 UI', () => {
  it('renders the approval inbox and decision reason control', () => {
    const html = render(<ApprovalsPage projectId="project" />);
    assert.match(html, /Approval inbox/);
    assert.match(html, /Decision reason/);
  });
  it('creates HUMAN_APPROVAL nodes with safe defaults', () => {
    const node = createWorkflowNode('HUMAN_APPROVAL', 0, 'approval');
    assert.deepEqual(node.data.config, {
      title: 'Approve generated response',
      instructions: 'Review generated response before continuing.',
      allow_reject: true,
    });
  });
  it('polls all active and paused states but stops for terminal states', () => {
    assert.equal(pollingIntervalForStatus('QUEUED'), 800);
    assert.equal(pollingIntervalForStatus('RUNNING'), 800);
    assert.equal(pollingIntervalForStatus('WAITING_FOR_APPROVAL'), 800);
    assert.equal(pollingIntervalForStatus('COMPLETED'), false);
    assert.equal(pollingIntervalForStatus('FAILED'), false);
    assert.equal(pollingIntervalForStatus('CANCELLED'), false);
  });
});
