import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, publicReferenceUrl, pageMediaLink } from '../src/server/security/public-reference.mjs';
import { referenceDefaults, updateReferencePrompt, suggestedReferencePrompt } from '../src/lib/reference-prompts.mjs';

test('reference defaults follow media type, retain custom instructions and clear when removed', () => {
  assert.equal(suggestedReferencePrompt(''), '');
  assert.equal(updateReferencePrompt('', 'video'), referenceDefaults.video);
  assert.equal(updateReferencePrompt(referenceDefaults.video, 'image'), referenceDefaults.image);
  assert.equal(updateReferencePrompt(referenceDefaults.image, ''), '');
  assert.equal(updateReferencePrompt('Keep my exact title', 'link'), 'Keep my exact title');
});
test('public references reject private, reserved, mapped and alternate-form IP addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
  for (const link of ['https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://[::ffff:127.0.0.1]', 'http://example.com', 'https://example.com:8443', 'https://user:password@example.com', 'https://localhost', 'https://host.local']) assert.throws(() => publicReferenceUrl(link), /public|Local|HTTPS/);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('page metadata resolves media without executing markup and validates extracted destinations', () => {
  assert.equal(pageMediaLink('<meta content="/film.mp4?a=1&amp;b=2" property="og:video"><meta property="og:image" content="/poster.jpg">', 'https://example.com/page').href, 'https://example.com/film.mp4?a=1&b=2');
  assert.throws(() => pageMediaLink('<meta property="og:image" content="http://127.0.0.1/private">', 'https://example.com'), /HTTPS/);
  assert.throws(() => pageMediaLink('<script>location="https://example.com/x.mp4"</script>', 'https://example.com'), /no readable/);
});
