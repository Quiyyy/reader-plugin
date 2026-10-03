// Test-only host, not part of the shipped reader UI or proof of ChatGPT compatibility.
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const iframe = document.getElementById('reader') as HTMLIFrameElement;
const calls: string[] = [];
const teardownRequests: number[] = [];
const bridge = new AppBridge(null, { name: 'Reader protocol test harness', version: '1.0.0' }, { serverTools: {}, serverResources: {}, experimental: { 'openai/resource': {} } }, { hostContext: { theme: 'light', displayMode: 'fullscreen' } });
bridge.oncalltool = async params => { calls.push(params.name); return (await fetch('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Client': 'preview' }, body: JSON.stringify(params) })).json(); };
const resources = new Map<string, { name: string; blob: string }>();
bridge.onreadresource = async params => { const resource = resources.get(params.uri); if (!resource) throw new Error('Unexpected resource URI'); return { contents: [{ uri: params.uri, mimeType: 'application/octet-stream', blob: resource.blob }] }; };
bridge.oninitialized = () => { void bridge.sendToolInput({ arguments: {} }); };
// Deliberately decline: receipt of a notification must never fake a closed UI.
bridge.onrequestteardown = () => { teardownRequests.push(Date.now()); };
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
(window as any).__readerHarness = {
  calls,
  teardownRequests,
  async openFile(name: string, blob: string) { const uri = `host-resource://reader-test/${encodeURIComponent(name)}`; resources.set(uri, { name, blob }); await bridge.sendToolInput({ arguments: { file: { name, resourceUri: uri } } }); },
  setTheme(theme: 'dark' | 'light') { bridge.setHostContext({ theme, displayMode: 'fullscreen' }); },
};
const source = await (await fetch('/')).text();
// Block iframe networking and book execution. Only the app's bundled inline script runs.
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`;
iframe.srcdoc = source.replace('<head>', '<head>' + csp);
