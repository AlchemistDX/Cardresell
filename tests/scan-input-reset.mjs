import {completionGuard} from './_complete.mjs';
const {finish} = completionGuard('scan-input-reset');
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync('index.html','utf8');
const source=readFileSync('.'+html.match(/\/js\/core\.[a-f0-9]{8}\.js/)[0],'utf8');
const nodes=new Map(), calls=[];
class Input {
 constructor(id,inline=true){this.id=id;this.inline=inline;this.listeners=[];this.value='photo';this.parentNode={replaceChild:(next)=>nodes.set(id,next)};}
 cloneNode(){return new Input(this.id,this.inline);}
 removeAttribute(name){assert.equal(name,'onchange');this.inline=false;}
 addEventListener(event,handler){assert.equal(event,'change');this.listeners.push(handler);}
 change(){if(this.inline)calls.push(this.id);for(const f of this.listeners)f.call(this);}
}
for(const id of ['scanFileInput','gradeFileInput','gradeBackFileInput','gradeEdgeTopInput','gradeEdgeBottomInput','gradeEdgeLeftInput','gradeEdgeRightInput']) nodes.set(id,new Input(id));
const context={document:{getElementById:id=>nodes.get(id)},processScanImage:e=>calls.push(e.id),processGradeImage:e=>calls.push(e.id),processGradeBack:e=>calls.push(e.id),processGradeEdge:e=>calls.push(e.id)};
const cancel=source.slice(source.indexOf('  // Reset scan file input',source.indexOf('function cancelScan()')),source.indexOf('  // If ID scan identified a card',source.indexOf('function cancelScan()')));
for(let cycle=0;cycle<3;cycle++){
 vm.runInNewContext('{'+cancel+'}',context);
 for(const id of ['scanFileInput','gradeFileInput','gradeBackFileInput']){calls.length=0;nodes.get(id).change();assert.deepEqual(calls,[id]);}
}
const start=source.indexOf('    // Clone-replace all grade file inputs');
const reset=source.slice(start,source.indexOf('\n\n  } catch(err)',start));
vm.runInNewContext(reset,context);
for(const id of ['gradeBackFileInput','gradeEdgeTopInput','gradeEdgeBottomInput','gradeEdgeLeftInput','gradeEdgeRightInput']){calls.length=0;nodes.get(id).change();assert.deepEqual(calls,[id]);}
console.log('PASS repeated scanner resets dispatch one handler per selected photo');

finish(1, 0); // one end-to-end assertion sequence; exceptions abort before this point
