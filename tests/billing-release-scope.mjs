// Offline release boundary: do not silently ship unrelated feature-branch code.
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {harness} from './_assert.mjs';
import {ID_BILLING_SCRIPT} from '../api/_idBilling.js';
const {check,done}=harness('billing-release-scope');
const ROOT=resolve(new URL('..',import.meta.url).pathname);
const BASE='ad7d2f78884897d066a173dc194d55f5946f8d84';
const at=(ref,file)=>execFileSync('git',['show',ref+':'+file],{cwd:ROOT,encoding:'utf8',maxBuffer:8*1024*1024});
const local=file=>readFileSync(resolve(ROOT,file),'utf8');
for(const file of ['api/_idBilling.js','api/_tier.js','api/scan-debit-id.js','api/scan-refund.js'])
 check(file+' is exact reviewed pre-harness product snapshot',local(file)===at('facc465',file));
check('billing Lua is exact managed six-case module',
 createHash('sha256').update(ID_BILLING_SCRIPT).digest('hex')==='7494e779bc0782a28d7546b7b3aaceb14e2153991c92793c0c1d6c425d075080');
const html=local('index.html'),oldHtml=at(BASE,'index.html');
check('index changes only the content-hash bundle reference',
 html.replace('/js/core.15fab283.js','/js/core.c6543908.js')===oldHtml);
check('new client filename matches its content hash',
 createHash('sha256').update(local('js/core.15fab283.js')).digest('hex').startsWith('15fab283'));
for(const file of ['js/core.c6543908.js','js/auth.5cf1cd22.js','api/_verifyToken.js','vercel.json'])
 check(file+' retains Production bytes',local(file)===at(BASE,file));
const before=at(BASE,'api/scan.js'),after=local('api/scan.js');
const ast=src=>parse(src,{ecmaVersion:'latest',sourceType:'module'}).body;
const helpers=src=>ast(src).filter(n=>n.type!=='ImportDeclaration'&&n.type!=='ExportDefaultDeclaration')
 .map(n=>src.slice(n.start,n.end));
check('all top-level grounding/helper code remains Production exact',
 JSON.stringify(helpers(before))===JSON.stringify(helpers(after)));
check('scan imports only one new billing dependency',
 JSON.stringify(ast(after).filter(n=>n.type==='ImportDeclaration').map(n=>n.source.value))
 ===JSON.stringify([...ast(before).filter(n=>n.type==='ImportDeclaration').map(n=>n.source.value),'./_idBilling.js']));
const apis=readdirSync(resolve(ROOT,'api'));
check('temporary Preview routes and helpers are absent',
 !apis.some(n=>/^(?:_preview|preview-id-)/i.test(n)));
check('no separate identity/catalog resolver is introduced',!apis.includes('_identityResolution.js'));
check('no root temporary response-suppression worker is introduced',
 !readdirSync(ROOT).some(n=>/preview.*(?:worker|sw)|stage2.*(?:worker|sw)/i.test(n)));
check('billing API files contain no temporary fence dependency',
 ['_idBilling.js','_tier.js','scan.js','scan-debit-id.js','scan-refund.js']
 .every(n=>!/_preview|preview-id-|STAGE2_|PREVIEW_ID_/.test(local('api/'+n))));
done();
