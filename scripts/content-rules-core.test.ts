import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../database/migrations/20260928143000_userflex_content_rules.sql', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../cloudflare/lib/content-rules.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../cloudflare/worker.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../cloudflare/lib/client.ts', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('../client-app/browser-engine/extension/content.js', import.meta.url), 'utf8');
const strategy = readFileSync(new URL('../client-app/browser-engine/extension/strategy.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ContentRulesView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.userflex_content_rules/i);
assert.match(migration, /create table if not exists public\.userflex_profile_content_rules/i);
assert.match(routes, /managedContentRulesForProfiles/);
assert.match(routes, /content_rule\.create/);
assert.match(routes, /content_rule\.profiles\.update/);
assert.match(worker, /adminContentRuleRoutes/);

assert.match(
  client,
  /managedContentRulesForProfiles\(env, profileIds\)/,
  'catalog must fetch managed content rules together with profile configuration',
);
assert.match(
  client,
  /contentRules: contentRuleMap\.get\(profile\.id\) \|\| \[\]/,
  'catalog must expose only the rules that apply to each profile',
);
assert.match(
  client,
  /contentRules: managedContentRules/,
  'launch response must carry managed content rules to userFLOW',
);

assert.match(
  engine,
  /globalThis\.USERFLEX_CONTENT_RULES = \$\{JSON\.stringify\(contentRules\)\}/,
  'Browser Guard strategy must receive centrally managed content rules',
);
assert.match(
  engine,
  /profile\?\.contentRules/,
  'content rules must participate in the running-profile configuration key',
);
assert.match(strategy, /USERFLEX_CONTENT_RULES = \[\]/);

assert.match(
  content,
  /currentHost === rule\.domain[\s\S]{0,100}currentHost\.endsWith/,
  'content rules must be domain scoped',
);
assert.match(
  content,
  /document\.querySelectorAll\(rule\.selector\)/,
  'Browser Guard must apply CSS selectors locally',
);
assert.match(
  content,
  /observer\.observe\(document\.documentElement \|\| document, \{[\s\S]{0,140}childList: true,[\s\S]{0,80}subtree: true/,
  'managed rule observer must react only to structural changes',
);
assert.doesNotMatch(
  content,
  /observer\.observe\(document\.documentElement \|\| document, \{[\s\S]{0,220}attributes: true/,
  'managed content rules must not watch style/class attribute churn',
);
assert.match(
  content,
  /setInterval\(scheduleContentRules, 20000\)/,
  'managed content rules must use a low-frequency fallback on heavy SPAs',
);
assert.doesNotMatch(
  content,
  /kaizzen\.org|kaizzen\.com/i,
  'Browser Guard core content rules must not depend on the third-party extension backend',
);

assert.match(view, /title="Reglas de página"/);
assert.match(view, /api\.contentRules\.setProfiles/);
assert.match(view, /Desactivar/);
assert.match(app, /case 'content-rules'/);

console.log('Core managed content rules: OK');
