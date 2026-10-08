#!/usr/bin/env node
// Offline preflight against the shipped prompt. Does not call any provider.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildVisionContent,requestBody} from './grade-model-eval.mjs';
import {sha256} from './prepare-grade-reference-pilot.mjs';
const [dir,model]=process.argv.slice(2);
if(!dir||!model)throw Error('Usage: node tools/check-grade-reference-pilot.mjs blinded-dir model-name');
const inputs=JSON.parse(readFileSync(join(dir,'inputs.json'),'utf8'));
const requests=inputs.map(row=>{
 if(row.mode!=='quick'||row.capture_type!=='slabbed'||row.split!=='development')throw Error('Unexpected sample scope');
 const images={};
 for(const side of ['front','back']){
  const im=row.images[side];
  if(im.file!==row.sample_id+'-'+side+'.png')throw Error('Unexpected input filename');
  const bytes=readFileSync(join(dir,im.file));
  if(sha256(bytes)!==im.sha256)throw Error('Masked image hash mismatch');
  images[side]=bytes.toString('base64');
 }
 const vc=buildVisionContent({mimeType:'image/png',imageBase64:images.front,backMimeType:'image/png',backBase64:images.back,isDeepGrade:false,isGradeMode:true});
 const body=requestBody(model,vc,{deep:false});
 return {sample_id:row.sample_id,prompt_sha256:sha256(JSON.stringify(vc.filter(x=>x.type==='text'))),request_sha256:sha256(JSON.stringify(body)),image_count:vc.filter(x=>x.type==='image_url').length};
});
console.log(JSON.stringify({status:'inputs_prepared_not_graded',provider_calls:0,pipeline:'shipped language-model prompt only; excludes CV and server postprocessing',model,requests},null,2));
