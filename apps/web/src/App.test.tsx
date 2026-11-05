import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';

describe('App', () => {
  it('labels planned workflow functionality honestly', () => {
    const html = renderToStaticMarkup(App());
    assert.match(html, /Build AI workflows you can trust/);
    assert.equal(html.match(/Planned for Milestone 1/g)?.length, 2);
  });
});
