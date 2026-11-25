// Test-only correlation of native window types and real local fixture pages.
// Edge can redact tab.url even when chrome.windows reports window IDs/types.
export async function inspectFixtureWindows(browser, workerSession, fixtureOrigin) {
  const reply = await workerSession.send('Runtime.evaluate', {
    expression: 'chrome.windows.getAll({populate:true,windowTypes:["normal","popup","app","panel","devtools"]}).then(ws=>ws.map(w=>({id:w.id,type:w.type,tabCount:(w.tabs||[]).length})))',
    awaitPromise:true, returnByValue:true,
  });
  if (reply?.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
  if (!Array.isArray(reply?.result?.value)) throw new Error('Browser Guard returned no native window list');
  const windows = reply.result.value.map(w => ({...w, urls:[]}));
  // Puppeteer 24 exposes the browser CDP session through its root target.
  const root = await browser.target().createCDPSession();
  try {
    const {targetInfos} = await root.send('Target.getTargets');
    for (const target of targetInfos) {
      if (target.type !== 'page') continue;
      let url;
      try { url = new URL(target.url); } catch { continue; }
      if (url.origin !== fixtureOrigin) continue;
      const {windowId} = await root.send('Browser.getWindowForTarget', {targetId:target.targetId});
      const window = windows.find(w => w.id === windowId);
      if (!window) throw new Error('Fixture page not mapped to a native window');
      window.urls.push(url.pathname);
    }
  } finally { await root.detach().catch(()=>null); }
  return windows;
}
