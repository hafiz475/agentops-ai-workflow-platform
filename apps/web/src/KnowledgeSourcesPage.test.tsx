import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeSourcesPage } from './KnowledgeSourcesPage';

describe('Knowledge Sources page', () => {
  it('renders source creation, provider selection, uploads, and status guidance', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <KnowledgeSourcesPage projectId="project" />
      </QueryClientProvider>,
    );
    assert.match(html, /Reusable grounded retrieval/);
    assert.match(html, /Create source/);
    assert.match(html, /Deterministic development/);
    assert.match(html, /TXT, PDF, or DOCX/);
  });
});
