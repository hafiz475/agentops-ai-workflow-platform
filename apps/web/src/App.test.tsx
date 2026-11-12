import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('renders the project entry point', () => {
    const html = renderToStaticMarkup(<App />);
    assert.match(html, /Design\. Evaluate\. Improve\./);
    assert.match(html, /Create project/);
    assert.match(html, /Retrieval and RAG online/);
  });
  it('renders the Milestone 5 retrieval entry point', () => {
    const html = renderToStaticMarkup(<App />);
    assert.match(html, /Milestone 5/);
    assert.match(html, /Retrieval and RAG online/);
  });
});
