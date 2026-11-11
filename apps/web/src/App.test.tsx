import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('renders the Milestone 4 branch-safe tool entry point', () => {
    const html = renderToStaticMarkup(<App />);
    assert.match(html, /Design\. Evaluate\. Improve\./);
    assert.match(html, /Create project/);
    assert.match(html, /Branch-safe tools online/);
  });
});
