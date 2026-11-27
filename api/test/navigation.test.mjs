import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNavigation } from '../src/modules/navigation/index.mjs';
import { makeSocle, rejects } from './helpers.mjs';
test('navigation validates presentation only, never destinations or arbitrary CSS', () => {
  const config = style => ({ version: 1, scopes: { site: { styles: { primary: { section: style } } } } });
  validateNavigation(config({ size: 18, color: '#123abc', activeColor: '#ffffff', spacing: 4 }));
  for (const style of [{ size: 11 }, { size: 29 }, { spacing: -1 }, { color: 'red;display:none' }, { fontFamily: 'serif' }, { href: '/other' }]) assert.throws(() => validateNavigation(config(style)), { code: 'VALIDATION' });
  assert.throws(() => validateNavigation({ version: 1, scopes: { site: { routes: {} } } }), { code: 'VALIDATION' });
  assert.throws(() => validateNavigation({ version: 1, scopes: { site: { labels: [] } } }), { code: 'VALIDATION' });
});
test('navigation settings persist globally and reject concurrent lost updates', async () => {
  const { socle, reload } = await makeSocle();
  const key = 'navigation.presentation';
  const value = { version: 1, scopes: { 'module:bpm': { labels: { '/tableau-de-bord': 'Mon budget' } }, 'page:/vision': { styles: { secondary: { detail: { size: 18 } } } } } };
  const result = await socle.modules.navigation.write({ expectedRevision: 0, value });
  assert.equal(result.parameter.revision, 1);
  await rejects(socle.modules.navigation.write({ expectedRevision: 0, value }), 'STALE_VERSION');
  const next = await reload();
  try { assert.deepEqual(next.modules.navigation.read(null).value, value); }
  finally { await next.close(); }
});
test('navigation order lists child keys per parent and nothing else', () => {
  const config = order => ({ version: 1, scopes: {}, order });
  validateNavigation(config({ 'zone:bpm': ['section:bpm:vision', 'section:bpm:ensemble'], '/plafonds': ['/plafonds/categories'] }));
  for (const order of [[], { 'zone:bpm': 'section:bpm:vision' }, { 'zone:bpm': [] }, { 'zone:bpm': ['a', 'a'] }, { 'zone:bpm': [1] }, { 'zone:bpm': [''] }, { '': ['a'] }, { 'zone:bpm': [{ link: '/other' }] }])
    assert.throws(() => validateNavigation(config(order)), { code: 'VALIDATION' });
});
test('navigation supports isolated menu surfaces and bounded extended styles', () => {
 const config=style=>({version:1,scopes:{'module:bpm':{styles:{contents:{content:style},actions:{detail:style}}}}});
 validateNavigation(config({radius:12,weight:650,horizontalPadding:16,minHeight:44,borderWidth:1,letterSpacing:1,hoverColor:'#123456',hoverBackground:'#ffffff',borderColor:'#123456'}));
 for(const invalid of [{radius:33},{weight:900},{minHeight:10},{horizontalPadding:-1},{borderWidth:5},{letterSpacing:1.5},{hoverColor:'transparent'}]) assert.throws(()=>validateNavigation(config(invalid)),{code:'VALIDATION'});
});
test('content menus validate triggers and interaction boundaries',()=>{
 const config=contentMenu=>({version:1,scopes:{'module:bpm':{contentMenu}}});
 validateNavigation(config({trigger:'click',width:400,closeDelay:200}));
 for(const invalid of [{trigger:'automatic'},{width:1000},{closeDelay:-1},{width:250.5},{href:'/somewhere'}])assert.throws(()=>validateNavigation(config(invalid)),{code:'VALIDATION'});
});
test('navigation system v2 validates home actions, section band and numbering',()=>{
 const config=contentMenu=>({version:1,scopes:{'module:bpm':{contentMenu}}});
 validateNavigation(config({homeTrigger:'hover',band:'off',numbers:'on'}));
 for(const invalid of [{homeTrigger:'always'},{band:true},{numbers:'yes'}])assert.throws(()=>validateNavigation(config(invalid)),{code:'VALIDATION'});
});
test('navigation relation configurations persist and reject malformed relationships', async () => {
  const value = {version:1,scopes:{},relations:{'zone:bpm':{
    '/tableau-de-bord/entrees':{parent:'/vision',surfaces:['secondary','primary']},
    '/vision':{home:'/tableau-de-bord/entrees'},
  }}};
  validateNavigation(value);
  for (const relation of [{parent:'/vision'}, {home:'/vision'}, {surfaces:['other']}, {href:'/other'}]) {
    assert.throws(() => validateNavigation({version:1,scopes:{},relations:{'zone:bpm':{'/vision':relation}}}), {code:'VALIDATION'});
  }
  assert.throws(() => validateNavigation({version:1,scopes:{},relations:{'zone:bpm':{
    a:{parent:'b'},b:{parent:'a'},
  }}}), {code:'VALIDATION'});
  const {socle,reload}=await makeSocle();
  await socle.modules.navigation.write({expectedRevision:0,value});
  const next=await reload();
  try { assert.deepEqual(next.modules.navigation.read(null).value,value); }
  finally { await next.close(); }
});
