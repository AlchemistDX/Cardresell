#!/usr/bin/env node
// Prepare deterministic, label-hidden test inputs. Never calls a grading API.
// npm install --no-save sharp (development tooling only)
// node tools/prepare-grade-reference-pilot.mjs manifest.json source-dir output-dir
// source-dir contains R01-front-large.jpg, R01-back-large.jpg, etc.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateReferenceManifest(manifest) {
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.records) || !manifest.records.length) throw Error('Empty/unsupported manifest');
  const ids=new Set(),certs=new Set(),images=new Set();
  for(const row of manifest.records){
    if(!/^R\d{2,}$/.test(row.sample_id)||ids.has(row.sample_id))throw Error('Invalid/duplicate sample ID');
    if(!/^\d+$/.test(row.cert_number)||certs.has(row.cert_number))throw Error('Invalid/duplicate physical-card cert');
    ids.add(row.sample_id);certs.add(row.cert_number);
    if(row.reference_grader!=='PSA'||row.reference_type!=='certified'||!Number.isInteger(row.reference_grade)||row.reference_grade<1||row.reference_grade>10)throw Error('Invalid reference');
    if(row.capture_type!=='slabbed'||row.split!=='development')throw Error('This pilot is slabbed development evidence only');
    const source=new URL(row.source_url);
    if(source.protocol!=='https:'||source.hostname!=='www.psacard.com'||!source.pathname.includes('/cert/'+row.cert_number))throw Error('Cert provenance mismatch');
    for(const side of ['front','back']){
      const im=row.images?.[side], c=im?.crop;
      if(!im||!c||!im.reviewed_labels_removed||!im.reviewed_card_complete)throw Error('Both faces need visual crop review');
      if(!/^[a-f0-9]{64}$/.test(im.sha256)||images.has(im.sha256))throw Error('Duplicate/invalid image hash');
      images.add(im.sha256);
      const url=new URL(im.url);
      if(url.protocol!=='https:'||url.hostname!=='d1htnxwo4o0jhw.cloudfront.net'||!url.pathname.startsWith('/cert/'))throw Error('Unexpected image origin');
      if(![im.width,im.height,c.left,c.top,c.width,c.height].every(Number.isInteger)||im.width<800||im.height<1000||c.left<0||c.top<=0||c.width<=0||c.height<=0||c.left+c.width>im.width||c.top+c.height>im.height)throw Error('Invalid/low-resolution crop');
    }
  }
  return manifest.records;
}
export async function prepareReferencePilot(manifest, sourceDir, outputDir) {
  const rows=validateReferenceManifest(manifest);
  const sharp=createRequire(import.meta.url)('sharp');
  if(resolve(sourceDir)===resolve(outputDir))throw Error('Keep sources and blinded inputs separate');
  // Validate all originals before producing any model inputs.
  const originals=new Map();
  for(const row of rows)for(const side of ['front','back']){
    const bytes=readFileSync(join(sourceDir,`${row.sample_id}-${side}-large.jpg`));
    const im=row.images[side], meta=await sharp(bytes).metadata();
    if(sha256(bytes)!==im.sha256||meta.width!==im.width||meta.height!==im.height)throw Error('Source image mismatch: '+row.sample_id+' '+side);
    originals.set(row.sample_id+side,bytes);
  }
  mkdirSync(outputDir,{recursive:true});
  const inputs=[];
  for(const row of rows){
    const item={sample_id:row.sample_id,mode:'quick',capture_type:'slabbed',split:'development',images:{}};
    for(const side of ['front','back']){
      // Lossless rectangular extraction only. No resizing, enhancement,
      // denoising, synthetic edges or removal of holder reflections.
      const bytes=await sharp(originals.get(row.sample_id+side)).extract(row.images[side].crop).png().toBuffer();
      const name=`${row.sample_id}-${side}.png`;writeFileSync(join(outputDir,name),bytes);
      item.images[side]={file:name,sha256:sha256(bytes)};
    }
    inputs.push(item);
  }
  // Model-facing file excludes grade, card name, cert, source URLs and answer key.
  writeFileSync(join(outputDir,'inputs.json'),JSON.stringify(inputs,null,2)+'\n');
  return inputs;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==5)throw Error('Usage: node tools/prepare-grade-reference-pilot.mjs manifest.json source-dir output-dir');
  const result=await prepareReferencePilot(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3],process.argv[4]);
  console.log(JSON.stringify({prepared:result.length,mode:'quick',capture_type:'slabbed',provider_calls:0}));
}
