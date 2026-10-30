import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('TEAMDROP forwards raw files to the authenticated Whiskay Bot relay', async () => {
  const server = await read('server.js');
  const env = await read('.env.example');
  assert.match(server, /WHISKAY_BOT_WEBHOOK_URL/);
  assert.match(server, /WHISKAY_BOT_WEBHOOK_TOKEN/);
  assert.match(server, /X-Teamdrop-Id/);
  assert.match(server, /X-Teamdrop-Filename/);
  assert.match(server, /eventId: entry\.id/);
  assert.match(server, /eventId: item\.id/);
  assert.doesNotMatch(server, /META_ACCESS_TOKEN|META_PHONE_NUMBER_ID|graph\.facebook\.com/);
  assert.match(env, /127\.0\.0\.1:8787\/webhooks\/teamdrop\/document/);
});

test('public browser assets never receive the private WhatsApp recipient or webhook token', async () => {
  const [app, admin, html] = await Promise.all([read('public/app.js'), read('public/admin.js'), read('public/index.html')]);
  for (const source of [app, admin, html]) {
    assert.doesNotMatch(source, /TEAMDROP_WHATSAPP_TO|WHISKAY_BOT_WEBHOOK_TOKEN|TEAMDROP_WEBHOOK_SECRET/);
  }
  assert.match(html, /Nomor WhatsApp tujuan tidak ditampilkan/);
});
