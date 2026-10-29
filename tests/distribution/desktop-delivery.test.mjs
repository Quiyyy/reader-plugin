import test from 'node:test';
import assert from 'node:assert/strict';
import { readerProcessesForRegistration, assertCliDeliverySafe, hostInstallAction } from '../../distribution/desktop-delivery.mjs';

const family='C:\\Users\\test\\.codex\\plugins\\cache\\reader-marketplace\\reader-win32-x64';
const registration={transport:{command:family+'\\0.2.12\\reader-launcher.exe'}};
test('a live desktop delivery cannot use the CLI cache-replacing path',()=>{
  assert.throws(()=>assertCliDeliverySafe('current-thread',[]),/desktop/);
  assert.throws(()=>assertCliDeliverySafe(undefined,[{ProcessId:1}]),/desktop/);
  assert.doesNotThrow(()=>assertCliDeliverySafe(undefined,[]));
});
test('process detection scopes all versions to the registered Reader family',()=>{
  const rows=[
    {Name:'reader-launcher.exe',ProcessId:1,ExecutablePath:family+'\\0.2.11\\reader-launcher.exe'},
    {Name:'reader-launcher.exe',ProcessId:2,ExecutablePath:family.toUpperCase()+'\\0.2.12\\reader-launcher.exe'},
    {Name:'reader-launcher.exe',ProcessId:3,ExecutablePath:family+'-other\\0.2.12\\reader-launcher.exe'},
    {Name:'codex.exe',ProcessId:4,ExecutablePath:'C:\\Codex\\codex.exe'},
    {Name:'reader-launcher.exe',ProcessId:5,ExecutablePath:null},
  ];
  assert.deepEqual(readerProcessesForRegistration(rows,registration).map(row=>row.ProcessId),[1,2]);
});
test('staging specifies the exact approved host installation target without reporting success',()=>{
  const receipt={phase:'awaiting-host-install',inspection:'/private/inspection.json',marketplace:'/private/marketplace',candidate:{version:'0.2.13',source:{commit:'a'.repeat(40)}}};
  const action=hostInstallAction(receipt);
  assert.equal(action.method,'desktop-plugin-install');assert.equal(action.pluginName,'reader-win32-x64');assert.equal(action.expectedVersion,'0.2.13');
  assert.equal(receipt.phase,'awaiting-host-install');assert.equal(action.verified,undefined);
  assert.throws(()=>hostInstallAction({...receipt,phase:'prepared'}));
});
