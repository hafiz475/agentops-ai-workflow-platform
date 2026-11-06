import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('renders the Milestone 1 project entry point', () => {
    const html = renderToStaticMarkup(<App />);
    assert.match(html, /Design\. Run\. Trace\./);
    assert.match(html, /Create project/);
    assert.match(html, /Execution online/);
  });
});
