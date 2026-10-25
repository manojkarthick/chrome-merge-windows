import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, rm, cp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectCDP } from "../tests/cdp.mjs";

// This harness owns a fresh browser session. It never attaches to a user profile.
const execute = promisify(execFile);
const profile = await mkdtemp(join(tmpdir(), "chrome-merge-test-"));
const session = `chrome-merge-test-${process.pid}`;
const otherProfile = await mkdtemp(join(tmpdir(), "chrome-merge-other-test-"));
const otherSession = `${session}-other`;
const extension = fileURLToPath(new URL("../extension/", import.meta.url));
const instrumentedExtension = await mkdtemp(join(tmpdir(), "chrome-merge-extension-test-"));
await cp(extension, instrumentedExtension, { recursive: true });
// Expose the same registered click handler only in the disposable test copy.
await appendFile(join(instrumentedExtension, "background.js"), "\nglobalThis.testHandleClick = handleClick;\n");
async function command(browserSession, ...args) {
  const env = { ...process.env };
  // Repeating the executable override resets agent-browser's launch options.
  // Apply it only at startup so subsequent calls retain the profile/extension.
  if (!args.includes("--profile")) delete env.AGENT_BROWSER_EXECUTABLE_PATH;
  const { stdout } = await execute("agent-browser", ["--session", browserSession, ...args, "--json"], { env, maxBuffer: 2 ** 20 }).catch((error) => {
    if (error.stdout) throw new Error(JSON.parse(error.stdout).error);
    throw error;
  });
  const response = JSON.parse(stdout);
  if (!response.success) throw new Error(JSON.stringify(response.error));
  return response.data;
}
const cli = (...args) => command(session, ...args);
const otherCli = (...args) => command(otherSession, ...args);
async function evaluate(code) {
  return (await cli("eval", "-b", Buffer.from(code).toString("base64"))).result;
}
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html lang="en"><title>Live fixture</title><label>Draft <input id="draft"></label><script>window.liveToken = crypto.randomUUID();</script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const passed = [];
let cdp;
function check(name, fn) { fn(); passed.push(name); console.log(`PASS ${name}`); }

try {
  await otherCli("--profile", otherProfile, "open", base + "/other-profile");
  const otherTab = (await otherCli("tab", "list")).tabs.find((tab) => tab.url === base + "/other-profile");
  assert.ok(otherTab, "The other-profile fixture should be open.");
  await otherCli("--pin-tab", "tab", otherTab.tabId);
  const browserVersion = (await otherCli("eval", "navigator.userAgent")).result;
  assert.ok(Number(browserVersion.match(/Chrome\/(\d+)/)?.[1]) >= 155, "Live tests require Chrome 155+. Set AGENT_BROWSER_EXECUTABLE_PATH to a compatible Chrome for Testing executable.");
  await otherCli("eval", "window.profileMarker = 'untouched'");
  await cli("--profile", profile, "--extension", instrumentedExtension, "open", "chrome://extensions");
  const setupTab = (await cli("tab", "list")).tabs.find((tab) => tab.url === "chrome://extensions/");
  assert.ok(setupTab, "The extension settings page should be open.");
  await cli("--pin-tab", "tab", setupTab.tabId);
  await cli("find", "role", "switch", "click", "--name", "Developer mode");
  await cli("wait", "--fn", `Boolean(document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list')?.shadowRoot?.querySelector('extensions-item'))`);
  const extensionId = await evaluate(`document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id`);
  await cli("open", `chrome://extensions/?id=${extensionId}`);
  await cli("find", "role", "switch", "click", "--name", "Allow in Incognito");
  const popupURL = `chrome-extension://${extensionId}/popup.html`;
  await cli("wait", "--fn", `(()=>{const data=document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-detail-view').data;return data.incognitoAccess.isActive && data.state==='ENABLED';})()`);
  await cli("open", popupURL);
  cdp = await connectCDP((await cli("get", "cdp-url")).cdpUrl);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await cli("wait", "--fn", 'document.querySelector("main").getAttribute("aria-busy") === "false"');
  const worker = (await cdp.send("Target.getTargets")).targetInfos.find((target) => target.url === `chrome-extension://${extensionId}/background.js`);
  const { sessionId: workerSession } = await cdp.send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
  const invokeClick = (tab, session = workerSession) => cdp.call(session, async (tab) => {
    await globalThis.testHandleClick(tab);
    return true;
  }, tab);
  const noOpTab = await evaluate(`(async()=>{const win=await chrome.windows.getCurrent({populate:true});return win.tabs.find(t=>t.active);})()`);
  let eventStart = cdp.events.length;
  await invokeClick(noOpTab);
  const noOp = await evaluate("chrome.action.getTitle({})");
  const popupEventsSince = (start) => {
    const events = cdp.events.slice(start);
    const created = new Set(events.filter((event) => event.method === "Target.targetCreated").map((event) => event.params.targetInfo.targetId));
    return events.filter((event) => created.has(event.params?.targetInfo?.targetId) && event.params.targetInfo.type === "page" && event.params.targetInfo.url === popupURL);
  };
  check("installed click handler handles a real no-op without opening a popup", () => {
    assert.match(noOp, /No other eligible/);
    assert.equal(popupEventsSince(eventStart).length, 0);
  });
  const harnessTab = (await cli("tab", "list")).tabs.find((tab) => tab.url === popupURL).tabId;
  await cli("--pin-tab", "tab", harnessTab);
  const fixture = await evaluate(`(async () => {
    const target = await chrome.windows.getCurrent({populate:true});
    const harness = target.tabs.find(t => t.active);
    const pin = await chrome.tabs.create({windowId:target.id, url:${JSON.stringify(base + "/destination")}, pinned:true, active:false});
    const destinationPair=[];
    for(const url of [${JSON.stringify(base + "/destination-left")},${JSON.stringify(base + "/destination-right")}]) destinationPair.push((await chrome.tabs.create({windowId:target.id,url,active:false})).id);
    const destinationSplit=await chrome.tabs.createSplit(destinationPair);
    const first = await chrome.windows.create({url:[${JSON.stringify(base + "/first")},${JSON.stringify(base + "/draft")},${JSON.stringify(base + "/draft-right")},${JSON.stringify(base + "/group-a")},${JSON.stringify(base + "/group-b")}], focused:false});
    const a = await chrome.tabs.query({windowId:first.id});
    await chrome.tabs.update(a[0].id, {pinned:true});
    const sourceSplit=await chrome.tabs.createSplit([a[1].id,a[2].id]);
    const group = await chrome.tabs.group({tabIds:[a[3].id,a[4].id],createProperties:{windowId:first.id}});
    const groupSplit=await chrome.tabs.createSplit([a[3].id,a[4].id]);
    await chrome.tabGroups.update(group,{title:'Research',color:'purple',collapsed:true});
    const second = await chrome.windows.create({url:[${JSON.stringify(base + "/second")},${JSON.stringify(base + "/second-pin-right")},${JSON.stringify(base + "/second-unpinned")}],focused:false});
    const b = await chrome.tabs.query({windowId:second.id});
    await chrome.tabs.update(b[0].id,{pinned:true});
    await chrome.tabs.update(b[1].id,{pinned:true});
    const pinnedSplit=await chrome.tabs.createSplit([b[0].id,b[1].id]);
    const minimized = await chrome.windows.create({url:${JSON.stringify(base + "/minimized")},state:'minimized'});
    const unsupported = await chrome.windows.create({url:${JSON.stringify(base + "/popup")},type:'popup',focused:false});
    const incognito = await chrome.windows.create({url:${JSON.stringify(base + "/incognito")},incognito:true,focused:false});
    window.fixture = {target:target.id,original:(await chrome.tabs.query({windowId:target.id})).filter(t=>t.id!==pin.id).map(t=>t.id),harness:harness.id,pin:pin.id,a:a.map(t=>t.id),b:b.map(t=>t.id),destinationPair,destinationSplit,sourceSplit,groupSplit,pinnedSplit,group,minimized:minimized.id,minimizedTabs:(await chrome.tabs.query({windowId:minimized.id})).map(t=>t.id),unsupported:unsupported.id,incognito:incognito?.id};
    return window.fixture;
  })()`);
  const contentTabs = (await cli("tab", "list")).tabs;
  const draftTab = contentTabs.find((tab) => tab.url === base + "/draft").tabId;
  await cli("tab", draftTab);
  const live = await evaluate(`(() => {document.querySelector('#draft').value='unsaved draft'; history.pushState({step:1},'', '/draft#one'); history.pushState({step:2},'', '/draft#two'); return {token:window.liveToken,length:history.length};})()`);
  await cli("tab", harnessTab);
  await evaluate(`(async()=>{await chrome.tabs.update(window.fixture.harness,{active:true});await chrome.windows.update(window.fixture.target,{focused:true});return true;})()`);
  eventStart = cdp.events.length;
  await cdp.evaluate(workerSession, `(()=>{globalThis.splitCalls=[];const create=chrome.tabs.createSplit;chrome.tabs.createSplit=async(pair)=>{const before=(await chrome.tabs.query({windowId:${fixture.target},active:true})).map(t=>t.id);const id=await create(pair);const after=(await chrome.tabs.query({windowId:${fixture.target},active:true})).map(t=>t.id);globalThis.splitCalls.push({pair,before,after,id});return id;};return true;})()`);
  await invokeClick({ id: fixture.harness, windowId: fixture.target });
  const splitCalls = await cdp.evaluate(workerSession, "globalThis.splitCalls");
  const merged = await evaluate(`(async()=>({tabs:await chrome.tabs.query({windowId:window.fixture.target}),group:await chrome.tabGroups.get(window.fixture.group),title:await chrome.action.getTitle({}),windows:await chrome.windows.getAll({populate:true})}))()`);
  check("toolbar click handler merged real live tab IDs in pin/order sections", () => {
    assert.deepEqual(merged.tabs.map((tab) => tab.id), [fixture.pin, fixture.a[0], fixture.b[0], fixture.b[1], ...fixture.original, ...fixture.a.slice(1), fixture.b[2], ...fixture.minimizedTabs]);
    assert.deepEqual(merged.tabs.filter((tab) => tab.pinned).map((tab) => tab.id), [fixture.pin,fixture.a[0],fixture.b[0],fixture.b[1]]);
    assert.match(merged.title, /Merged 9 tabs from 3 windows/);
  });
  check("destination active tab and original group ID/appearance survived", () => {
    assert.equal(merged.tabs.find((tab) => tab.active).id, fixture.harness);
    assert.equal(merged.group.id, fixture.group);
    assert.equal(merged.group.title, "Research");
    assert.equal(merged.group.color, "purple");
    assert.equal(merged.group.collapsed, true);
    assert.equal(merged.group.windowId, fixture.target);
  });
  const paired = (ids) => {
    const tabs=ids.map(id=>merged.tabs.find(tab=>tab.id===id));
    assert.ok(tabs[0].splitViewId >= 0);
    assert.equal(tabs[0].splitViewId,tabs[1].splitViewId);
    return tabs[0].splitViewId;
  };
  check("ungrouped source splits are rebuilt with the same live tabs", () => {
    assert.notEqual(paired(fixture.a.slice(1,3)),fixture.sourceSplit);
    assert.ok(splitCalls.some(call=>JSON.stringify(call.pair)===JSON.stringify(fixture.a.slice(1,3))));
  });
  check("pinned source splits are rebuilt inside the pinned section", () => {
    assert.notEqual(paired(fixture.b.slice(0,2)),fixture.pinnedSplit);
    assert.ok(fixture.b.slice(0,2).every(id=>merged.tabs.find(tab=>tab.id===id).pinned));
  });
  check("native group movement preserves its contained split", () => {
    assert.equal(paired(fixture.a.slice(3,5)),fixture.groupSplit);
    assert.ok(!splitCalls.some(call=>call.pair.includes(fixture.a[3])));
  });
  check("destination splits retain their original identity", () => assert.equal(paired(fixture.destinationPair),fixture.destinationSplit));
  check("only rebuilt splits add the layout-reset tooltip note", () => assert.match(merged.title,/Rebuilt 2 source split views side-by-side at 50\/50/));
  console.log(JSON.stringify({splitCreationActivation:splitCalls.map(({before,after})=>({before,after}))}));
  check("minimized tabs merge while popup and Incognito windows stay outside the merge", () => {
    assert.ok(fixture.minimizedTabs.every((id) => merged.tabs.some((tab) => tab.id === id)));
    assert.ok(merged.windows.some((win) => win.id === fixture.unsupported));
    assert.ok(!merged.tabs.some((tab) => tab.incognito));
    assert.doesNotMatch(merged.title, /Skipped|SKIP/);
  });
  const harnessTarget = contentTabs.find((tab) => tab.tabId === harnessTab).targetId;
  check("a successful merge including minimized windows opens no popup", () => assert.equal(popupEventsSince(eventStart).length, 0));
  await cli("wait", "--fn", `(async()=> (await chrome.action.getBadgeText({})) === '')()`);
  check("the success badge clears after one second", () => {});
  const targetsAfterMerge = await cdp.send("Target.getTargets");
  check("private source page remains outside the regular merge", () => assert.ok(targetsAfterMerge.targetInfos.some((target) => target.url === base + "/incognito")));
  await cli("tab", draftTab);
  const after = await evaluate(`({token:window.liveToken,value:document.querySelector('#draft').value,length:history.length,state:history.state})`);
  check("real unsaved input, page identity, and navigation history survived", () => {
    assert.equal(after.token, live.token);
    assert.equal(after.value, "unsaved draft");
    assert.equal(after.length, live.length);
    assert.equal(after.state.step, 2);
  });
  await cli("back");
  const historyState = await evaluate("history.state");
  check("back navigation still reaches the prior history entry", () => assert.equal(historyState.step, 1));
  await cli("tab", harnessTab);
  // Fault injection wraps one worker API call; other transfers use Chrome itself.
  const partial = await evaluate(`(async()=>{
    const source=await chrome.windows.create({url:[${JSON.stringify(base + "/partial-a")},${JSON.stringify(base + "/partial-b")},${JSON.stringify(base + "/partial-c")}],focused:false});
    const tabs=await chrome.tabs.query({windowId:source.id});
    await chrome.tabs.update(window.fixture.harness,{active:true});
    return {source:source.id,failID:tabs[1].id,expected:tabs.slice(1).map(t=>t.id)};
  })()`);
  await cdp.call(workerSession, async (failID, tab) => {
    const move = chrome.tabs.move;
    chrome.tabs.move = async (id, props) => {
      if (id === failID) throw new Error("Injected move failure.");
      return move(id, props);
    };
    try {
      await globalThis.testHandleClick(tab);
    } finally {
      chrome.tabs.move = move;
    }
    return true;
  }, partial.failID, { id: fixture.harness, windowId: fixture.target });
  const failed = await evaluate(`(async()=>({title:await chrome.action.getTitle({}),remaining:(await chrome.tabs.query({windowId:${partial.source}})).map(t=>t.id)}))()`);
  check("injected failure stops real moves and leaves remaining source tabs intact", () => {
    assert.match(failed.title, /Stopped after 1 tab moved/);
    assert.deepEqual(failed.remaining, partial.expected);
  });
  const errorPopup = (await cdp.send("Target.getTargets")).targetInfos.find((target) => target.url === popupURL && target.type === "page" && target.targetId !== harnessTarget);
  assert.ok(errorPopup, "A failed move should open details.");
  const { sessionId: errorSession } = await cdp.send("Target.attachToTarget", { targetId: errorPopup.targetId, flatten: true });
  const errorDetails = await cdp.evaluate(errorSession, `(async()=>{for(let i=0;i<100;i++){if(document.querySelector('main')?.getAttribute('aria-busy')==='false')return document.querySelector('#status').textContent;await new Promise(r=>setTimeout(r,50));}throw new Error('Error popup did not load.');})()`);
  check("only errors open readable details with partial completion", () => assert.match(errorDetails, /Stopped after 1 tab moved.*Injected move failure/));
  await cdp.send("Target.closeTarget", { targetId: errorPopup.targetId });
  eventStart = cdp.events.length;
  await invokeClick({ id: fixture.harness, windowId: fixture.target });
  const retryTitle = await evaluate("chrome.action.getTitle({})");
  check("a successful retry after an error opens no popup", () => {
    assert.match(retryTitle, /Merged 2 tabs from 1 window/);
    assert.equal(popupEventsSince(eventStart).length, 0);
  });
  const other = (await otherCli("eval", "({marker:window.profileMarker,url:location.href})")).result;
  check("a second isolated profile's page remains untouched", () => {
    assert.equal(other.marker, "untouched");
    assert.equal(other.url, base + "/other-profile");
  });
  await cli("tab", harnessTab);
  const regularBefore = await evaluate(`(async()=>(await chrome.windows.getAll({populate:true})).filter(w=>!w.incognito).map(w=>({id:w.id,tabs:w.tabs.map(t=>t.id)})))()`);
  const priorTargets = new Set((await cdp.send("Target.getTargets")).targetInfos.map((target) => target.targetId));
  await evaluate(`chrome.windows.create({incognito:true,url:${JSON.stringify(popupURL)},focused:false})`);
  const privatePage = (await cdp.send("Target.getTargets")).targetInfos.find((target) => target.url === popupURL && !priorTargets.has(target.targetId));
  assert.ok(privatePage, "The private extension page should exist.");
  const { sessionId: privateSession } = await cdp.send("Target.attachToTarget", { targetId: privatePage.targetId, flatten: true });
  await cdp.evaluate(privateSession, `(async()=>{for(let i=0;i<100;i++){if(document.querySelector('main')?.getAttribute('aria-busy')==='false')return true;await new Promise(r=>setTimeout(r,50));}throw new Error('Private popup did not finish.');})()`);
  const incognitoFixture = await cdp.evaluate(privateSession, `(async()=>{
    const target=await chrome.windows.getCurrent({populate:true});
    const active=target.tabs.find(t=>t.active);
    const source=await chrome.windows.create({url:[${JSON.stringify(base + "/private-a")},${JSON.stringify(base + "/private-b")}],focused:false});
    const incoming=(await chrome.windows.getAll({populate:true,windowTypes:['normal']})).filter(w=>w.id!==target.id).sort((a,b)=>a.id-b.id).flatMap(w=>w.tabs.map(t=>t.id));
    window.privateFixture={target:target.id,active:active.id,original:target.tabs.map(t=>t.id),incoming};
    await chrome.windows.update(target.id,{focused:true});
    return window.privateFixture;
  })()`);
  const privateWorker = (await cdp.send("Target.getTargets")).targetInfos.find((target) => target.url === `chrome-extension://${extensionId}/background.js` && target.browserContextId === privatePage.browserContextId);
  const { sessionId: privateWorkerSession } = await cdp.send("Target.attachToTarget", { targetId: privateWorker.targetId, flatten: true });
  await invokeClick({ id: incognitoFixture.active, windowId: incognitoFixture.target }, privateWorkerSession);
  const privateResult = await cdp.evaluate(privateSession, `(async()=>{for(let i=0;i<100;i++){const title=await chrome.action.getTitle({});if(title.includes('Merged 3 tabs'))return {incognito:chrome.extension.inIncognitoContext,status:title,tabs:await chrome.tabs.query({windowId:window.privateFixture.target})};await new Promise(r=>setTimeout(r,50));}throw new Error('Private toolbar merge did not finish.');})()`);
  check("enabled Incognito uses its separate context and merges only private tabs", () => {
    assert.equal(privateResult.incognito, true);
    assert.match(privateResult.status, /Merged 3 tabs from 2 windows/);
    assert.deepEqual(privateResult.tabs.map((tab)=>tab.id), [...incognitoFixture.original,...incognitoFixture.incoming]);
    assert.ok(privateResult.tabs.every((tab)=>tab.incognito));
    assert.equal(privateResult.tabs.find((tab)=>tab.active).id, incognitoFixture.active);
  });
  await cli("tab", harnessTab);
  const regularAfter = await evaluate(`(async()=>(await chrome.windows.getAll({populate:true})).filter(w=>!w.incognito).map(w=>({id:w.id,tabs:w.tabs.map(t=>t.id)})))()`);
  check("Incognito invocation leaves all regular windows unchanged", () => assert.deepEqual(regularAfter, regularBefore));
  console.log(JSON.stringify({ browser: await evaluate("navigator.userAgent"), passed: passed.length, note: "Native source, grouped, pinned, and destination split membership verified. Visual help-tip/layout checks remain manual." }, null, 2));
} catch (error) {
  console.error(JSON.stringify(await cli("snapshot", "-i").catch(() => null)));
  throw error;
} finally {
  cdp?.close();
  await cli("close").catch(() => {});
  await otherCli("close").catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
  await rm(otherProfile, { recursive: true, force: true });
  await rm(instrumentedExtension, { recursive: true, force: true });
}
