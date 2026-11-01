import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyPageText, profileOwner, MemberStop, sniff} from './executor.mjs';
import {completionFor, processJob, parseMemberSettings, archiveDirFor, memberLaunchArgs, launchAgentPlans, launchAgentPlist, superviseAccounts, startMemberWorker, ARCHIVE_DIR} from './worker.mjs';

test('page text maps to fixed reasons only', () => {
  assert.equal(classifyPageText('Please verify you are human'), 'CAPTCHA');
  assert.equal(classifyPageText('You have reached your daily limit. Upgrade to SuperGrok'), 'QUOTA');
  assert.equal(classifyPageText('This request was moderated'), 'CONTENT');
  assert.equal(classifyPageText('', 'https://accounts.x.ai/sign-in'), 'LOGIN');
  assert.equal(classifyPageText('图片 速度 质量 2.0'), null);
});
test('a live Chrome owning the profile is reported busy', async () => {
  assert.equal(await profileOwner('/p', {readlink: async () => 'Mac-mini.local-2418', alive: () => true}), 2418);
  assert.equal(await profileOwner('/p', {readlink: async () => 'Mac-mini.local-2418', alive: () => false}), null);
  assert.equal(await profileOwner('/p', {readlink: async () => {throw Error('ENOENT');}}), null);
});
test('definite stops release quota, unknown endings stay uncertain', () => {
  assert.deepEqual(completionFor(new MemberStop('CAPTCHA')), {error: 'REJECTED', reason: 'CAPTCHA'});
  assert.deepEqual(completionFor(new MemberStop('TIMEOUT', false)), {error: 'UNCERTAIN', reason: 'TIMEOUT'});
  assert.deepEqual(completionFor(new Error('boom')), {error: 'UNCERTAIN', reason: 'PAGE'});
});
test('a busy profile fails the job without opening the page', async () => {
  let imagined = false;
  const {result} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '1:1'}, {
    open: async () => {throw new MemberStop('BUSY');}, imagine: async () => {imagined = true;}, log: () => {},
  });
  assert.deepEqual(result, {error: 'REJECTED', reason: 'BUSY'}); assert.equal(imagined, false);
});
test('连接异常写出状态码和错误类型，非 401 按退避等待，401 停止', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const {startMemberWorker} = await import('./worker.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jbp-member-'));
  const connection = path.join(root, 'connection.json');
  const configFile = path.join(root, 'config.json');
  const profile = path.join(root, 'profile');
  await fs.mkdir(profile);
  await fs.writeFile(connection, JSON.stringify({format:'jbp-mac-image-worker-v1', origin:'https://jubaopeng-canvas.vercel.app', workerId:'primary', workerToken:'t'.repeat(43)}));
  await fs.writeFile(configFile, JSON.stringify({connection, profileDir:profile}));
  const waits = [], logs = [];
  let n = 0;
  const transport = async () => {
    n++;
    if (n === 1) return {connected:true};
    if (n === 2) throw Object.assign(Error('down'), {kind:'temporary', type:'5xx', status:503});
    if (n === 3) return {job:null};
    throw Object.assign(Error('revoked'), {kind:'revoked', type:'4xx', status:401});
  };
  try {
    await startMemberWorker({configFile, homeDir:root, log:line => logs.push(line), sleep:async ms => {waits.push(ms);}, random:() => 0, transport, pollMs:10000});
    assert.match(logs.find(line => line.includes('连接异常：5xx，HTTP 503')) || '', /5xx，HTTP 503/);
    assert.match(logs.find(line => line.includes('HTTP 401')) || '', /4xx，HTTP 401/);
    assert.deepEqual(waits, [1000, 10000]);
  } finally {await fs.rm(root, {recursive:true, force:true});}
});
test('structure and video failures are explicit and are not run twice', async () => {
  let runs = 0;
  const stopped = await processJob({id:'x', type:'edit', references:[], prompt:'p', ratio:'1:1'}, {
    open: async () => ({close: async () => {}}),
    imagine: async () => {runs++; const error = new MemberStop('STRUCTURE', true); error.step = '改图'; error.detail = '网页结构变化：改图'; throw error;},
    log: () => {},
  });
  assert.equal(runs, 1);
  assert.deepEqual(stopped.result, {error:'REJECTED', reason:'STRUCTURE', step:'改图'});
  let opened = false;
  const video = await processJob({type:'video', references:[], prompt:'p'}, {open: async () => {opened = true;}, imagine: async () => {runs++;}, log: () => {}});
  assert.deepEqual(video.result, {error:'REJECTED', reason:'UNSUPPORTED'});
  assert.equal(opened, false);
  assert.equal(runs, 1);
});
test('reference files are prepared once and an account label selects its archive folder', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let seen = 0;
  const {result} = await processJob({id:'12345678-1234-4123-8123-123456789abc', references:[png], prompt:'p', ratio:'1:1'}, {
    open: async () => ({close: async () => {}}),
    imagine: async (_context, job) => {seen = job.files.length; return {bytes: Buffer.from([255,216,1,2,3,4,5,6,7,8,255,217])};},
    compress: async bytes => ({mime:'image/jpeg', bytes, before:7, after:7, original:'/o.jpg'}),
    log: () => {},
    archiveDir: archiveDirFor('甲', '/tmp/jbp-archive'),
  });
  assert.equal(seen, 1);
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(archiveDirFor('', ARCHIVE_DIR), ARCHIVE_DIR);
  assert.equal(archiveDirFor('甲'), ARCHIVE_DIR + '/甲');
  assert.throws(() => archiveDirFor('a/b'));
  assert.throws(() => archiveDirFor('user@example.com'));
});
test('two accounts stay independent when one pauses', async () => {
  const plans = [{label:'a', account:'甲'}, {label:'b', account:'乙'}];
  const result = await superviseAccounts(plans, plan => plan.account === '甲' ? Promise.reject(Error('captcha')) : Promise.resolve('ok'));
  assert.deepEqual(result.map(item => item.ok), [false, true]);
  const root = '/tmp/jbp-member-config';
  const settings = {extraOrigins:['https://sunny.example'], accounts:[
    {label:'甲', connection:root+'/a.json', profileDir:root+'/profile-a'},
    {label:'乙', connection:root+'/b.json', profileDir:root+'/profile-b'},
  ]};
  assert.deepEqual(memberLaunchArgs(settings).map(item => item.args), [['--account','甲'],['--account','乙']]);
  assert.throws(() => parseMemberSettings({...settings, connection:root+'/a.json'}));
  assert.throws(() => parseMemberSettings({accounts:[{label:'甲', connection:root+'/a.json', profileDir:root+'/profile-a'}, {label:'甲', connection:root+'/b.json', profileDir:root+'/profile-b'}]}));
  assert.deepEqual(parseMemberSettings({connection:root+'/a.json', profileDir:root+'/profile-a'}).accounts, [{label:'', connection:root+'/a.json', profileDir:root+'/profile-a'}]);
  const agents = launchAgentPlans({settings, node:'/usr/bin/node', script:'/work/worker.mjs', configFile:root+'/config.json', homeDir:root+'/home'});
  assert.deepEqual(agents.map(item => item.label), ['com.jubaopeng.grok-member-worker.1','com.jubaopeng.grok-member-worker.2']);
  assert.ok(agents[0].args.includes('--account') && agents[0].args.includes('甲'));
  assert.match(agents[0].log, /\/甲\/worker\.log$/);
  const plist = launchAgentPlist(agents[0]);
  assert.match(plist, /SuccessfulExit/);
  assert.equal(plist.includes('workerToken'), false);
  assert.equal(plist.includes('@'), false);
});
test('a structure failure is completed once and does not take the next job', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jbp-member-pause-'));
  const connection = path.join(root, 'connection.json');
  const configFile = path.join(root, 'config.json');
  const profile = path.join(root, 'profile');
  await fs.mkdir(profile);
  await fs.writeFile(connection, JSON.stringify({format:'jbp-mac-image-worker-v1', origin:'https://jubaopeng-canvas.vercel.app', workerId:'primary', workerToken:'t'.repeat(43)}));
  await fs.writeFile(configFile, JSON.stringify({connection, profileDir:profile}));
  const id = '12345678-1234-4123-8123-123456789abc';
  const job = {id, lease:'l'.repeat(43), prompt:'猫', ratio:'1:1', resolution:'1k', references:[]};
  const calls = [];
  let runs = 0;
  const transport = async (_connection, action, body) => {
    calls.push({action, body});
    if (action === 'heartbeat') return {connected:true};
    if (action === 'poll') return calls.filter(item => item.action === 'poll').length === 1 ? {job} : {job:{...job, id:'12345678-1234-4123-8123-123456789abd'}};
    return {saved:true, status:'failed'};
  };
  try {
    const paused = await startMemberWorker({configFile, homeDir:root, log:() => {}, sleep:async () => {}, random:() => 0, transport, pollMs:1, runJob: async () => {runs++; return {result:{error:'REJECTED', reason:'STRUCTURE', step:'上传参考图'}, stats:{}};}});
    assert.equal(paused.paused, 'STRUCTURE');
    assert.equal(runs, 1);
    assert.equal(calls.filter(item => item.action === 'poll').length, 1);
    assert.equal(calls.filter(item => item.action === 'complete').length, 1);
    assert.equal(calls.find(item => item.action === 'complete').body.accountLabel, undefined);
    assert.equal(JSON.stringify(calls).includes('t'.repeat(10)), false);
  } finally {await fs.rm(root, {recursive:true, force:true});}
});
test('labeled accounts send the label, keep separate locks, and a video job does not open the page', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jbp-member-accounts-'));
  const home = path.join(root, 'home');
  const profileA = path.join(root, 'profile-a'), profileB = path.join(root, 'profile-b');
  await fs.mkdir(profileA); await fs.mkdir(profileB);
  const writeConnection = async name => {
    const file = path.join(root, name + '.json');
    await fs.writeFile(file, JSON.stringify({format:'jbp-mac-image-worker-v1', origin:'https://sunny.example', workerId:'primary', workerToken:'t'.repeat(43)}));
    return file;
  };
  const connectionA = await writeConnection('a'), connectionB = await writeConnection('b');
  const configFile = path.join(root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify({extraOrigins:['https://sunny.example'], accounts:[
    {label:'甲', connection:connectionA, profileDir:profileA},
    {label:'乙', connection:connectionB, profileDir:profileB},
  ]}));
  const video = {id:'12345678-1234-4123-8123-123456789abc', lease:'l'.repeat(43), type:'video', prompt:'走路', ratio:'16:9', resolution:'720p', duration:6, audio:false, references:[]};
  const imageJob = {id:video.id, lease:video.lease, prompt:'猫', ratio:'1:1', resolution:'1k', references:[]};
  const common = {configFile, homeDir:home, log:() => {}, sleep:async () => {}, random:() => 0, pollMs:1};
  try {
    const lockDir = path.join(home, 'accounts', '甲');
    await fs.mkdir(lockDir, {recursive:true});
    await fs.writeFile(path.join(lockDir, 'worker.lock'), '999');
    await assert.rejects(() => startMemberWorker({...common, account:'甲', transport:async () => {throw Error('must not poll');}}), /甲/);
    let otherPolls = 0;
    await startMemberWorker({...common, account:'乙', runJob: async () => {throw Error('乙 should not receive a job');}, transport: async () => {
      otherPolls++;
      if (otherPolls === 1) return {connected:true};
      throw Object.assign(Error('revoked'), {kind:'revoked', status:401});
    }});
    assert.equal(otherPolls > 1, true);
    await fs.unlink(path.join(lockDir, 'worker.lock'));
    const seen = [];
    await startMemberWorker({...common, account:'甲', runJob: async () => {throw Error('video must not run');}, transport: async (connection, action, body) => {
      seen.push({origin:connection.origin, action, account:body?.accountLabel, reason:body?.reason, workerId:body?.workerId});
      if (action === 'heartbeat') return {connected:true};
      if (action === 'poll') {
        const n = seen.filter(item => item.action === 'poll').length;
        if (n === 1) return {job:video};
        throw Object.assign(Error('revoked'), {kind:'revoked', status:401});
      }
      return {saved:true, status:'failed'};
    }});
    const complete = seen.find(item => item.action === 'complete');
    assert.equal(complete.account, '甲');
    assert.equal(complete.workerId, 'primary');
    assert.equal(complete.reason, 'UNSUPPORTED');
    assert.equal(complete.origin, 'https://sunny.example');
    assert.equal(JSON.stringify(seen).includes('t'.repeat(20)), false);
    let runs = 0, polls = 0;
    await startMemberWorker({...common, account:'乙', runJob: async () => {runs++; return {result:{error:'REJECTED', reason:'CONTENT'}, stats:{}};}, transport: async (_connection, action, body) => {
      if (action === 'heartbeat') return {connected:true};
      if (action === 'poll') {
        polls++;
        if (polls === 1) return {job:imageJob};
        if (polls === 2) return {job:null};
        throw Object.assign(Error('revoked'), {kind:'revoked', status:401});
      }
      assert.equal(body.accountLabel, '乙');
      assert.equal(body.workerId, 'primary');
      return {saved:true, status:'failed'};
    }});
    assert.equal(runs, 1);
  } finally {await fs.rm(root, {recursive:true, force:true});}
});
test('a finished page image is compressed and sent as a data URL', async () => {
  const jpeg = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
  const {result, stats} = await processJob({id: 'x', references: [], prompt: 'p', ratio: '1:1'}, {
    open: async () => ({close: async () => {}}), imagine: async () => ({bytes: jpeg}), log: () => {},
    compress: async bytes => ({mime: 'image/jpeg', bytes, before: 7, after: 7, original: '/o.jpg'}),
  }).catch(e => ({result: {thrown: e.message}}));
  assert.ok(result.dataUrl?.startsWith('data:image/jpeg;base64,') || result.error, JSON.stringify(result));
  assert.equal(sniff(jpeg).mime, 'image/jpeg'); void stats;
});
