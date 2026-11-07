import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluationPollingInterval, EvaluationsPage, parseJsonObject } from './EvaluationsPage';
import { PromptsPage } from './PromptsPage';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
describe('Milestone 2 pages', () => {
  it('renders the prompt list, version editor, and immutable-version controls', () => {
    const html = render(<PromptsPage projectId="project" />);
    assert.match(html, /Prompt Registry/i);
    assert.match(html, /Create prompt/);
    assert.match(html, /immutable versions/i);
  });
  it('renders dataset creation, evaluation launch, results metrics, and comparison controls', () => {
    const html = render(<EvaluationsPage projectId="project" />);
    assert.match(html, /Evaluation dataset/);
    assert.match(html, /Add case/);
    assert.match(html, /Run Evaluation/);
    assert.match(html, /Compare two completed runs/);
  });
  it('parses object inputs and polls only running evaluations', () => {
    assert.deepEqual(parseJsonObject('{"input":"Docker"}'), { input: 'Docker' });
    assert.throws(() => parseJsonObject('[]'), /object/);
    assert.equal(evaluationPollingInterval('QUEUED'), 800);
    assert.equal(evaluationPollingInterval('RUNNING'), 800);
    assert.equal(evaluationPollingInterval('COMPLETED'), false);
    assert.equal(evaluationPollingInterval('FAILED'), false);
  });
});
