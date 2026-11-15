import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  restrictedPopupUrl,
  restrictedAppWindowArgs,
  startRestrictedWindowGuard,
} from '../client-app/browser-engine/restricted-window-guard.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
assert.equal(restrictedPopupUrl('https://example.com/login'), 'https://example.com/login');
assert.equal(restrictedPopupUrl('http://localhost:2000/'), 'http://localhost:2000/');
for (const rejected of ['chrome://extensions', 'edge://settings', 'javascript:alert(1)',
  'data:text/html,hi', 'file:///C:/file', 'https://user:secret@site.test/']) {
  assert.equal(restrictedPopupUrl(rejected), null, rejected);
}
const args = restrictedAppWindowArgs({
  userDataDir: 'C:\\Users\\Demo\\Profile1',
  url: 'https://members.example.com/page',
  proxyRules: 'socks5://127.0.0.1:9020',
});
assert.ok(args.includes('--app=https://members.example.com/page'));
assert.ok(args.some((arg) => arg.startsWith('--user-data-dir=')));
assert.ok(args.includes('--proxy-server=socks5://127.0.0.1:9020'));
assert.ok(args.includes('--disable-quic'));
assert.equal(args.some((arg) => arg.includes('chrome://extensions')), false);
assert.throws(() => restrictedAppWindowArgs({userDataDir:'C:/profile',url:'edge://extensions'}));

class FakeSession extends EventEmitter {
  async send() { return {}; }
  async detach() {}
}
class FakeBrowser extends EventEmitter {
  constructor(initial) {
    super();
    this.initial = initial;
  }
  targets() { return this.initial; }
  async disconnect() { this.disconnected = true; }
}
function fakeTarget(url, opener = null) {
  const session = new FakeSession();
  const target = {
    currentUrl: url,
    closed: false,
    session,
    type() { return 'page'; },
    url() { return this.currentUrl; },
    opener() { return opener; },
    async createCDPSession() { return session; },
    async page() {
      return { close: async () => { target.closed = true; } };
    },
  };
  return target;
}

const home = fakeTarget('https://home.test');
const browser = new FakeBrowser([home]);
const launched = [];
const monitor = await startRestrictedWindowGuard({
  connectBrowser: async () => browser,
  debugPort: 9200,
  initialUrl: 'https://home.test',
  launchAppWindow: async (url) => launched.push(url),
  logger: { warn: (text) => { throw new Error('Unexpected guard warning: '+text); } },
  settleMs: 0,
});
assert.equal(home.closed, false, 'original restricted app page must be preserved');

const popup = fakeTarget('https://example.com/new-tab', home);
browser.emit('targetcreated', popup);
await delay(75);
assert.equal(popup.closed, true, 'new popup must close before reopening as an app');
assert.deepEqual(launched, ['https://example.com/new-tab']);
assert.equal(monitor.routedCount, 1);

const expectedApp = fakeTarget('https://example.com/new-tab');
browser.emit('targetcreated', expectedApp);
await delay(75);
assert.equal(expectedApp.closed, false, 'new controlled --app target must not be closed');
assert.equal(launched.length, 1, 'new app window must not trigger an infinite relaunch');
browser.emit('targetdestroyed', expectedApp);

home.session.emit('Page.windowOpen', { url: 'https://example.com/noopener' });
const noOpener = fakeTarget('https://example.com/noopener');
browser.emit('targetcreated', noOpener);
await delay(75);
assert.equal(noOpener.closed, true, '_blank with rel=noopener should also be guarded');
assert.equal(launched[1], 'https://example.com/noopener');

const newApp = fakeTarget('https://example.com/noopener');
browser.emit('targetcreated', newApp);
await delay(75);
assert.equal(newApp.closed, false);

const internal = fakeTarget('edge://extensions/');
browser.emit('targetcreated', internal);
await delay(75);
assert.equal(internal.closed, true, 'Edge internal management pages must not stay open as new windows');
assert.equal(launched[2], 'https://home.test/', 'unsupported new tabs return to the authorized home app');

const newHomeApp = fakeTarget('https://home.test/');
browser.emit('targetcreated', newHomeApp);
await delay(75);
assert.equal(newHomeApp.closed, false);

await monitor.close();
assert.equal(browser.disconnected, true);
const late = fakeTarget('https://example.com/late', home);
browser.emit('targetcreated', late);
await delay(75);
assert.equal(late.closed, false, 'closing the monitor should remove CDP event listeners');
console.log('Restricted Edge popup routing: OK');
