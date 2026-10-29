import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageStartupDiagnostic,persistImageStartupDiagnostic} from '../image-diagnostics.mjs';
import {createBackend} from '../backend.mjs';

const configuration = {key: 'synthetic-secret', baseUrl: 'https://provider.example/v1', model: 'private-model'};
const PREFIX = '[jbp-image-startup]';

test('missing image key causes no request or log, including repeated startup calls', async () => {
  const diagnose = createImageStartupDiagnostic({fetcher: () => assert.fail('unexpected request'), logger: () => assert.fail('unexpected log'),
    onResult: () => assert.fail('unexpected result')});
  const first = diagnose({key: ''});
  assert.equal(diagnose(configuration), first);
  assert.equal(await first, undefined);
});

test('concurrent and later calls share exactly one metadata GET and cancel its body unread', async () => {
  let calls = 0, cancelled = 0, finish;
  const logs = [], outcomes = [];
  const diagnose = createImageStartupDiagnostic({logger: (...args) => logs.push(args), onResult: value => outcomes.push(value), fetcher: (url, options) => {
    calls++;
    assert.equal(url, configuration.baseUrl + '/api-key');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, {Authorization: 'Bearer ' + configuration.key});
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
    return new Promise(resolve => { finish = resolve; });
  }});
  const first = diagnose(configuration);
  assert.equal(diagnose(configuration), first);
  finish({status: 200, body: {cancel: async () => {cancelled++;}},
    json: () => assert.fail('must not read account body'), text: () => assert.fail('must not read account body')});
  assert.deepEqual(await first, {kind: 'http', httpStatus: 200, code: null});
  assert.equal(diagnose(configuration), first);
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
  assert.deepEqual(logs, [[PREFIX, {kind: 'http', httpStatus: 200, code: null}]]);
  assert.deepEqual(outcomes, [{kind: 'http', httpStatus: 200, code: null}]);
  assert.ok(Object.isFrozen(outcomes[0]));
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-secret|provider|private-model|Authorization/);
});

test('HTTP failures cancel the body and log only their numeric HTTP status', async () => {
  for (const status of [401, 403, 503]) {
    let cancelled = 0;
    const logs = [];
    const diagnose = createImageStartupDiagnostic({logger: (...args) => logs.push(args), fetcher: async () => ({
      status, body: {cancel: async () => {cancelled++; throw Error('synthetic-secret account body');}},
      get headers() {assert.fail('must not inspect upstream headers');},
      get url() {assert.fail('must not inspect upstream URL');},
      json: () => assert.fail('must not read account body'), text: () => assert.fail('must not read account body'),
    })});
    assert.deepEqual(await diagnose(configuration), {kind: 'http', httpStatus: status, code: null});
    assert.equal(cancelled, 1);
    assert.deepEqual(logs, [[PREFIX, {kind: 'http', httpStatus: status, code: null}]]);
  }
});

test('network errors expose only allowlisted root or cause codes and never error contents', async () => {
  for (const [error, code] of [
    [{code: 'ENOTFOUND'}, 'ENOTFOUND'],
    [{cause: {code: 'EAI_AGAIN'}}, 'EAI_AGAIN'],
    [{cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}, 'UND_ERR_CONNECT_TIMEOUT'],
    ...['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].map(code => [{cause: {code}}, code]),
    [{code: 'synthetic-secret'}, undefined],
    [{cause: {code: 'https://provider.example/?key=synthetic-secret'}}, undefined],
  ]) {
    const logs = [];
    for (const field of ['message', 'stack', 'body', 'headers', 'url'])
      Object.defineProperty(error, field, {get() {assert.fail('must not inspect ' + field);}});
    const diagnose = createImageStartupDiagnostic({logger: (...args) => logs.push(args), fetcher: async () => {throw error;}});
    const safe = {kind: 'network', httpStatus: null, code: code ?? null};
    assert.deepEqual(await diagnose(configuration), safe);
    assert.deepEqual(logs, [[PREFIX, safe]]);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-secret|provider|message|stack|body|headers|url/);
  }
});

test('a pending request aborts at ten seconds, reports timeout, and is never retried', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0, signal;
  const logs = [];
  const diagnose = createImageStartupDiagnostic({logger: (...args) => logs.push(args), fetcher: (_url, options) => {
    calls++; signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  }});
  const result = diagnose(configuration);
  t.mock.timers.tick(9_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await result, {kind: 'timeout', httpStatus: null, code: null});
  assert.equal(diagnose(configuration), result);
  assert.equal(calls, 1);
  assert.deepEqual(logs, [[PREFIX, {kind: 'timeout', httpStatus: null, code: null}]]);
});

test('logger failure cannot reject or repeat the startup check', async () => {
  let calls = 0;
  const diagnose = createImageStartupDiagnostic({logger: () => {throw Error('synthetic-secret');}, fetcher: async () => {
    calls++; return {status: 200, body: null};
  }});
  await diagnose(configuration);
  await diagnose(configuration);
  assert.equal(calls, 1);
});

test('unusual rejected values cannot turn the diagnostic into a raw unhandled error', async () => {
  for (const error of [null, undefined, Object.defineProperty({}, 'cause', {get() {throw Error('synthetic-secret');}})]) {
    const logs = [];
    const diagnose = createImageStartupDiagnostic({logger: (...args) => logs.push(args), fetcher: async () => {throw error;}});
    assert.deepEqual(await diagnose(configuration), {kind: 'network', httpStatus: null, code: null});
    assert.deepEqual(logs, [[PREFIX, {kind: 'network', httpStatus: null, code: null}]]);
  }
});

test('result callback failure cannot reveal data, reject or repeat the metadata check', async () => {
  let calls = 0;
  const diagnose = createImageStartupDiagnostic({logger: () => {}, onResult: async result => {
    assert.deepEqual(result, {kind: 'http', httpStatus: 200, code: null});
    throw Error('synthetic-secret callback');
  }, fetcher: async () => {calls++; return {status: 200, body: null};}});
  await diagnose(configuration);
  await diagnose(configuration);
  assert.equal(calls, 1);
});

test('persistence upserts only the fixed internal row with sanitized schema and no account data', async () => {
  let calls = 0;
  assert.equal(await persistImageStartupDiagnostic(async (sql, params) => {
    calls++;
    assert.match(sql, /^INSERT INTO studio_service_diagnostics /);
    assert.match(sql, /ON CONFLICT \(name\) DO UPDATE/);
    assert.equal(params[0], 'image-connection');
    assert.deepEqual(JSON.parse(params[1]), {kind: 'network', httpStatus: null, code: 'ENOTFOUND'});
    assert.ok(Number.isInteger(params[2]));
    assert.doesNotMatch(JSON.stringify(params), /synthetic-secret|provider|private-model|body|headers|account/);
  }, {kind: 'network', httpStatus: 'synthetic-secret', code: 'ENOTFOUND', body: 'synthetic-secret account', configuration}), true);
  assert.equal(calls, 1);
  await persistImageStartupDiagnostic(() => assert.fail('no result must not write'), undefined);
});

test('persistence failure emits only a fixed marker and never the database error', async () => {
  const logs = [];
  assert.equal(await persistImageStartupDiagnostic(async () => {throw Error('synthetic-secret database URL');},
    {kind: 'http', httpStatus: 200, code: null}, {logger: (...args) => logs.push(args)}), false);
  assert.deepEqual(logs, [[PREFIX, 'persist-unavailable']]);
});

test('backend offers its existing image configuration once without rereading environment or exposing it in responses', async () => {
  let reads = 0;
  const configurations = [];
  const env = {JBP_IMAGE_EXECUTION: 'direct', get XAI_API_KEY() {reads++; return configuration.key;}, XAI_IMAGE_MODEL: configuration.model};
  const backend = await createBackend({query: async () => [], publicOrigin: 'https://studio.example', env,
    onImageConfiguration: value => configurations.push(value)});
  // imageServerConfig checks the env value type and then reads its value once.
  assert.equal(reads, 2);
  assert.equal(configurations.length, 1);
  assert.deepEqual(configurations[0], {...configuration, baseUrl: 'https://api.x.ai/v1'});
  const response = await backend(new Request('https://studio.example/api/images?action=status'));
  assert.doesNotMatch(await response.text(), /synthetic-secret|private-model|api\.x\.ai/);
  assert.equal(reads, 2);
  assert.equal(configurations.length, 1);
});
