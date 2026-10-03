const assert=require('node:assert/strict');
const {test}=require('node:test');
require('../home-core.js');
const H=globalThis.HomeCore;
const messages=n=>Array.from({length:n},(_,i)=>({id:String(i+1),role:i%2?'assistant':'user',content:'Message '+(i+1)}));
test('legacy data migrates to one project without changing text or sharing new personas',()=>{
 const memory={core:'Old identity\n  exact spaces',alisa:'User biography',recent:'Recent notes',kept:'An approved fact'};
 const lore=[{id:'entry',name:'Old entry',content:'Preserve this',keywords:'entry',enabled:true}];
 const projects=H.normalizeProjects([],memory,lore);
 assert.equal(projects[0].prompt,memory.core);assert.equal(projects[0].memory.kept,memory.kept);assert.deepEqual(projects[0].lorebook,lore);
 const other=H.newProject('Another persona');assert.equal(other.prompt,'');assert.deepEqual(other.lorebook,[]);assert.equal(other.memory.kept,'');
 assert.equal(H.normalizeProjects(projects,{core:'Wrong overwrite'},[])[0].prompt,memory.core);
});
test('every context layer stays inside its project and prompt Off leaves saved text intact',()=>{
 const a=H.newProject('A',{prompt:'IDENTITY A',memory:{alisa:'USER A',recent:'RECENT A',kept:'KEEP A'},lorebook:[{name:'A lore',content:'LORE A',keywords:'garden',enabled:true}]});
 const b=H.newProject('B',{prompt:'IDENTITY B',memory:{kept:'KEEP B'},lorebook:[{name:'B lore',content:'LORE B',keywords:'garden',enabled:true}]});
 const context=H.projectContext(b,[{role:'user',content:'garden'}],{text:'THIS CHAT SUMMARY'});
 assert.match(context.text,/IDENTITY B/);assert.match(context.text,/LORE B/);assert.match(context.text,/KEEP B/);assert.match(context.text,/THIS CHAT SUMMARY/);
 for(const text of ['IDENTITY A','USER A','RECENT A','KEEP A','LORE A'])assert.ok(!context.text.includes(text));
 b.promptEnabled=false;assert.ok(!H.projectContext(b,[],{}).text.includes('IDENTITY B'));assert.equal(b.prompt,'IDENTITY B');
 assert.equal(H.wakeLorebook(a,[{role:'user',content:'An unrelated topic'}]).length,0);
});
test('prompt History stores the original and new text without duplicating unchanged saves',()=>{
 const project=H.newProject('A',{prompt:'Previous exact text'});
 const edited=H.reviseProject(project,{prompt:'Changed exact text',promptEnabled:false});
 assert.equal(edited.revisions[0].prompt,'Previous exact text');assert.equal(edited.revisions.at(-1).prompt,'Changed exact text');
 assert.equal(project.revisions.length,0);assert.equal(H.reviseProject(edited,{prompt:edited.prompt,promptEnabled:false}),edited);
});
test('folding protects ten completed messages for all windows and chunk sizes',()=>{
 for(const count of [0,1,9,10,11,20,21,50,51,90])for(const window of [2,10,20,50])for(const chunk of [4,20,80]){
  const list=messages(count);const batch=H.foldBatch(list,{},window,chunk,true);
  assert.ok(batch.length<=Math.max(0,count-10));
  for(const message of list.slice(-10))assert.ok(!batch.includes(message));
 }
 assert.equal(H.foldBatch(messages(21),{},20,20).length,11);
});
test('successive folds neither repeat nor skip sources',()=>{
 const list=messages(90);const first=H.foldBatch(list,{},50,40);
 const summary={text:'Earlier',throughMessageId:first.at(-1).id,upto:first.length};
 const next=H.foldBatch(list,summary,50,40,true);
 assert.deepEqual(first.concat(next).map(m=>m.id),list.slice(0,80).map(m=>m.id));
 assert.deepEqual(H.historyForRequest(list,{text:'Earlier',throughMessageId:'80'},50).map(m=>m.id),list.slice(-10).map(m=>m.id));
});
test('failed, empty and streaming messages do not consume protected places',()=>{
 const list=messages(11).concat([{id:'live',content:'Draft',live:true},{id:'failed',content:'Error',err:true},{id:'empty',content:''}]);
 assert.deepEqual(H.foldBatch(list,{},10,20).map(m=>m.id),['1']);
 assert.equal(H.historyForRequest(list,{},10).length,11);
});
test('unreviewed history survives keeper failures and old summaries recover the latest ten',()=>{
 const list=messages(51);assert.equal(H.historyForRequest(list,{},20,true).length,51);
 assert.equal(H.historyForRequest(list,{},2,false).length,10);
 assert.equal(H.historyForRequest(list,{text:'Old summary',upto:51},20,true).length,10);
 assert.equal(H.historyForRequest(list,{text:'Summary',throughMessageId:'deleted'},20,true).length,51);
});
test('stable summary cursors survive deletion before the marker',()=>{
 const list=messages(30);const migrated=H.normalizeSummary(list,{text:'Older',upto:20});assert.equal(migrated.throughMessageId,'20');
 list.splice(0,1);assert.equal(H.summaryCursor(list,migrated),18);
 assert.deepEqual(H.historyForRequest(list,migrated,20).map(m=>m.id),messages(30).slice(20).map(m=>m.id));
});
test('v2 archive round trips all projects, chat summaries and trays and omits API keys',()=>{
 const projects=[H.newProject('A',{prompt:'Prompt A'}),H.newProject('B',{prompt:'Prompt B'})];
 const chats=[{id:'a',title:'Chat A',projectId:projects[0].id},{id:'b',title:'Chat B',projectId:projects[1].id}];
 const msgs={a:messages(25),b:messages(10)};const summaries={a:{text:'Summary A',upto:15,throughMessageId:'15'},b:{text:'',upto:0}};
 const trays={[projects[0].id]:[{text:'A candidate'}],[projects[1].id]:[{text:'B candidate'}]};
 const archive=H.archiveData({settings:{key:'NEVER EXPORT',model:'model'},projects,chats,projectId:projects[1].id,cur:'b'},msgs,summaries,{},trays);
 assert.ok(!JSON.stringify(archive).includes('NEVER EXPORT'));
 const restored=H.restoreArchive(JSON.parse(JSON.stringify(archive)),'DEVICE KEY');assert.equal(restored.settings.key,'DEVICE KEY');
 assert.deepEqual(restored.projects,projects);assert.deepEqual(restored.trays,trays);assert.equal(restored.cur,'b');assert.equal(restored.summaries.a.text,'Summary A');assert.deepEqual(restored.messages,msgs);
});
test('v1 imports preserve old conversation memory and assign a valid project',()=>{
 const restored=H.restoreArchive({version:1,memory:{core:'Old prompt',kept:'Old fact'},lorebook:[],chats:[{id:'old'}],messages:{old:messages(25)},summaries:{old:{text:'Previous summary',upto:15}},pending:{old:[{text:'Pending'}]},tray:[{text:'Later'}]},'key');
 assert.equal(restored.projects[0].prompt,'Old prompt');assert.equal(restored.chats[0].projectId,restored.projects[0].id);
 assert.equal(restored.summaries.old.throughMessageId,'15');assert.equal(restored.pending.old[0].text,'Pending');assert.equal(restored.trays[restored.projectId][0].text,'Later');
 assert.throws(()=>H.restoreArchive({version:99},''));
});
