import test from 'node:test';
import assert from 'node:assert/strict';
import {spatialEvidence} from '../../src/ui/spatial-model.js';
import {buildSpatialSvg, createSpatialGeometry, normalizeSpatialView, projectSpatialFaces, projectSpatialPoint, SPATIAL_MODEL, SPATIAL_TOPICS} from '../../src/ui/spatial-geometry.js';

const evidence=(topic,source='s1',note='분류 이유')=>({topic_id:topic,source_id:source,evidence_note:note,review_status:'demo'});
const project=(id,items)=>({project_id:id,title:id,topic_evidence:items});
const snapshot={sources:[{source_id:'s1',title:'연결 출처',url:'https://example.org/source',verification_status:'demo'},
  {source_id:'unrelated',title:'무관한 출처',url:'https://example.org/unrelated'}]};

test('spatial evidence uses only the filtered projects, deduplicating projects without mutating inputs',()=>{
  const inside=Object.freeze(project('inside',Object.freeze([Object.freeze(evidence('outdoor_learning'))])));
  const outside=project('outside',[evidence('outdoor_learning','unrelated')]);
  const input=Object.freeze([inside,inside,project('unclassified',[])]);
  const result=spatialEvidence(input,{...snapshot,projects:[inside,outside]},'outdoor_learning');
  assert.equal(result.denominator,2);
  assert.deepEqual(result.matches.map(item=>item.project.project_id),['inside']);
  assert.deepEqual(result.sourceIds,['s1']);
  assert.equal(result.matches[0].project,inside);
});

test('each spatial keyword connects only its own evidence and never infers from prose or other topics',()=>{
  const p=project('p',[evidence('community_sharing'),evidence('flexible_learning','unrelated')]);
  p.summary='중정 외부학습공간';
  assert.equal(spatialEvidence([p],snapshot,'outdoor_learning').matches.length,0);
  assert.deepEqual(spatialEvidence([p],snapshot,'community_sharing').sourceIds,['s1']);
  assert.deepEqual(spatialEvidence([p],snapshot,'flexible_learning').sourceIds,['unrelated']);
  assert.equal(spatialEvidence([p],snapshot,'carbon_energy').matches.length,0);
});

test('missing sources and source descriptions stay explicitly unknown; no unrelated source fallback',()=>{
  const result=spatialEvidence([project('p',[evidence('outdoor_learning','missing',null),evidence('outdoor_learning',null)])],snapshot,'outdoor_learning');
  assert.equal(result.matches.length,1);
  assert.equal(result.missingSources,2);
  assert.deepEqual(result.sourceIds,[]);
  assert.equal(result.matches[0].evidence[0].source,null);
  assert.equal(result.matches[0].evidence[0].note,'근거 설명 미확인');
});

test('source links reject active schemes and credentials but retain source existence and review state',()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml,a','file:///tmp/file','https://user:pass@example.org/a']){
    const result=spatialEvidence([project('p',[evidence('outdoor_learning')])],{sources:[{source_id:'s1',url,verification_status:'unknown'}]},'outdoor_learning');
    assert.equal(result.matches[0].evidence[0].source.url,null);
    assert.equal(result.matches[0].evidence[0].source.verification_status,'unknown');
    assert.deepEqual(result.sourceIds,['s1']);
  }
});

test('empty and malformed input never acquires matching cases or crashes',()=>{
  for(const input of [null,{},[],[null,{},'item',project('p',[null,'item',[],{}])]]){
    assert.equal(spatialEvidence(input,{sources:{}},'outdoor_learning').matches.length,0);
  }
});

test('each keyword produces a bounded finite campus with its own learning space',()=>{
  for(const topic of SPATIAL_TOPICS) {
    const faces=createSpatialGeometry({},topic.id);
    assert.ok(faces.length>100 && faces.length<3500,'bounded scene complexity');
    for(const face of faces){
      assert.ok(face.points.length>=3);
      for(const point of face.points){assert.equal(point.length,3);assert.ok(point.every(Number.isFinite));}
    }
    assert.ok(faces.some(face=>face.topic===topic.id),'the selected concept is physically represented');
  }
});

test('each layout keeps its main campus and teaching spaces when its enclosure is opened',()=>{
  for(const {id} of SPATIAL_TOPICS) {
    const closed=createSpatialGeometry({},id),open=createSpatialGeometry({cutaway:true},id);
    assert.ok(open.length<closed.length);
    assert.deepEqual(open,closed.filter(face=>!face.enclosure));
    assert.ok(open.some(face=>face.topic===id && face.layer==='building'));
    assert.ok(open.some(face=>!face.topic && face.layer==='building'),'main school mass remains opaque');
  }
});

test('every layout starts solid and transparency affects only its designated enclosure',()=>{
  for(const {id} of SPATIAL_TOPICS) {
    const solid=createSpatialGeometry({},id),half=createSpatialGeometry({transparency:50},id),open=createSpatialGeometry({transparency:100},id);
    assert.ok(solid.every(face=>face.opacity===1));
    assert.equal(half.length,solid.length);
    assert.deepEqual(half.map(face=>face.points),solid.map(face=>face.points));
    assert.ok(half.some(face=>face.enclosure && face.opacity===0.5));
    assert.ok(half.filter(face=>!face.enclosure).every(face=>face.opacity===1));
    assert.ok(half.filter(face=>face.enclosure).every(face=>face.topic===id));
    assert.deepEqual(open,solid.filter(face=>!face.enclosure));
  }
});

test('site is painted behind buildings and visible roofs and main walls survive every view',()=>{
  for(const {id} of SPATIAL_TOPICS) for(const angle of [-180,-90,0,32,90,180]) {
    const faces=projectSpatialFaces({angle},id);
    const firstBuilding=faces.findIndex(face=>face.layer==='building');
    assert.ok(firstBuilding>0);
    assert.ok(faces.slice(firstBuilding).every(face=>face.layer==='building'),'no ground face can cover a building');
    assert.ok(faces.some(face=>face.color==='#f1eee3' && face.layer==='building'),'roofs remain visible');
    assert.ok(faces.some(face=>face.color==='#ddd8c9' && !face.topic && face.layer==='building'),'main school exterior remains visible');
  }
});

test('camera screen height and depth form orthogonal axes; farther ground moves upward',()=>{
  const origin=projectSpatialPoint([0,0,0],{angle:0});
  const up=projectSpatialPoint([0,1,0],{angle:0});
  const back=projectSpatialPoint([0,0,1],{angle:0});
  assert.ok(back.y<origin.y && back.depth>origin.depth);
  const dot=(up.y-origin.y)*(up.depth-origin.depth)+(back.y-origin.y)*(back.depth-origin.depth);
  assert.ok(Math.abs(dot)<1e-10,'screen and sorting axes cannot describe different cameras');
});

test('all campus buildings and topic labels fit the scene at maximum zoom through full rotation',()=>{
  for(const topic of SPATIAL_TOPICS) {
    const points=[...new Map(createSpatialGeometry({},topic.id).filter(face=>face.layer==='building')
      .flatMap(face=>face.points).map(point=>[point.join(','),point])).values()];
    for(let angle=-180;angle<=180;angle+=4) {
      const view={angle,zoom:130};
      for(const point of points) {
        const p=projectSpatialPoint(point,view);
        assert.ok(p.x>=0 && p.x<=800 && p.y>=0 && p.y<=420,`${topic.id}, ${angle} degrees: building clipped`);
      }
      const marker=projectSpatialPoint(topic.point,view);
      assert.ok(marker.x-72>=0 && marker.x+72<=800 && marker.y-67>=0 && marker.y+7<=420,'topic label remains within scene');
    }
  }
});

test('rotation and zoom change projection, while higher points project upward and toward the viewer',()=>{
  const a=projectSpatialPoint([5,0,4],{angle:0,zoom:100});
  const rotated=projectSpatialPoint([5,0,4],{angle:90,zoom:100});
  assert.notEqual(rotated.x,a.x);assert.notEqual(rotated.y,a.y);
  const zoomed=projectSpatialPoint([5,0,4],{angle:0,zoom:120});
  assert.ok(Math.abs(zoomed.x-400)>Math.abs(a.x-400));
  const upper=projectSpatialPoint([5,2,4],{angle:0,zoom:100});
  assert.ok(upper.y<a.y);assert.ok(upper.depth<a.depth);
});

test('view inputs remain bounded and malformed values cannot poison SVG coordinates',()=>{
  assert.deepEqual(normalizeSpatialView({angle:Infinity,zoom:'bad',cutaway:'yes'}),{angle:32,zoom:100,transparency:0});
  assert.deepEqual(normalizeSpatialView({angle:500,zoom:2,cutaway:true}),{angle:180,zoom:80,transparency:100});
  assert.equal(normalizeSpatialView({transparency:-10}).transparency,0);
  assert.equal(normalizeSpatialView({transparency:999}).transparency,100);
  assert.equal(normalizeSpatialView({transparency:'bad'}).transparency,0);
  assert.equal(normalizeSpatialView({transparency:'45',cutaway:true}).transparency,45);
  const svg=buildSpatialSvg({view:{angle:NaN,zoom:Infinity}});
  assert.doesNotMatch(svg,/NaN|Infinity/);
});

test('keyword selection changes building shape rather than only marker, metadata or colour',()=>{
  const polygons=svg=>[...svg.matchAll(/<polygon points="([^"]+)"/g)].map(match=>match[1]);
  for(const transparency of [0,50,100]) {
    const view=Object.freeze({angle:76,zoom:110,transparency});
    const scenes=SPATIAL_TOPICS.map(({id})=>({
      geometry:createSpatialGeometry(view,id).filter(face=>face.layer==='building').map(face=>face.points),
      svg:polygons(buildSpatialSvg({topicId:id,view})),
    }));
    for(let a=0;a<scenes.length;a++) for(let b=a+1;b<scenes.length;b++) {
      assert.notDeepEqual(scenes[a].geometry,scenes[b].geometry);
      assert.notDeepEqual(scenes[a].svg,scenes[b].svg);
    }
    for(const [i,{id}] of SPATIAL_TOPICS.entries()) {
      assert.deepEqual(polygons(buildSpatialSvg({topicId:id,view})),scenes[i].svg,'switching back gives the original layout and view');
    }
    assert.deepEqual(view,{angle:76,zoom:110,transparency});
  }
});

test('layouts share the same site footprint and each export describes the selected alternative',()=>{
  const footprints=SPATIAL_TOPICS.map(({id})=>createSpatialGeometry({},id).filter(face=>face.points.every(point=>point[1]<=0)).map(face=>face.points));
  for(const footprint of footprints.slice(1))assert.deepEqual(footprint,footprints[0]);
  for(const topic of SPATIAL_TOPICS) {
    assert.equal(topic.designMoves.length,3);
    const svg=buildSpatialSvg({topicId:topic.id,view:{angle:72,zoom:115,transparency:50},report:{scopeLabel:'2025년'}});
    assert.ok(svg.includes(topic.layoutLabel));
    assert.ok(svg.includes(topic.id));
    assert.ok(svg.includes('2025년'));
  }
});

test('SVG metadata keeps selected layout and view consistent and unknown keywords use the same fallback',()=>{
  const decode=value=>value.replace(/&(amp|lt|gt|quot|apos);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]));
  for(const topic of SPATIAL_TOPICS) {
    const view={angle:-48,zoom:130,transparency:50};
    const svg=buildSpatialSvg({topicId:topic.id,view});
    const metadata=JSON.parse(decode(svg.match(/<metadata>(.*?)<\/metadata>/s)[1]));
    assert.equal(metadata.topic_id,topic.id);
    assert.equal(metadata.layout_label,topic.layoutLabel);
    assert.equal(metadata.layout_id,`${SPATIAL_MODEL.model_id}-${topic.id}`);
    assert.deepEqual(metadata.view,view);
  }
  assert.equal(buildSpatialSvg({topicId:'unknown'}),buildSpatialSvg());
  assert.deepEqual(createSpatialGeometry({},'unknown'),createSpatialGeometry());
});

test('export contains model type, creator, source, rights, scope and assumptions; strings cannot inject SVG',()=>{
  const hostile='</metadata><script>alert(1)</script><svg onload="alert(1)">';
  const svg=buildSpatialSvg({topicId:'community_sharing',view:{cutaway:true},report:{
    scopeLabel:hostile,projectIds:['selected-project'],sourceIds:['selected-source'],is_demo:true,
    sources:[{source_id:'selected-source',title:hostile,url:'https://example.org/source'}],missingSourceCount:1,
  }});
  assert.ok(svg.includes('fictional_concept'));
  assert.ok(svg.includes(SPATIAL_MODEL.creator));
  assert.ok(svg.includes('외부 도면/사진 미사용'));
  assert.ok(svg.includes('라이선스 미정'));
  assert.ok(svg.includes('실제 학교 재현'));
  assert.ok(svg.includes('selected-project'));assert.ok(svg.includes('https://example.org/source'));
  assert.ok(svg.includes('가상 자료'));assert.ok(svg.includes('출처 연결 미확인 1건'));
  assert.doesNotMatch(svg,/<script|<svg onload|<image|<foreignObject|<a |href=/i);
  assert.equal((svg.match(/<metadata>/g)||[]).length,1);
  assert.equal((svg.match(/<\/metadata>/g)||[]).length,1);
  assert.ok(svg.includes('&lt;/metadata&gt;'));
});

test('SVG has accessible text alternatives and instance-specific identifiers without dependencies',()=>{
  const svg=buildSpatialSvg({idPrefix:'model-2'});
  assert.ok(svg.includes('aria-labelledby="model-2-title model-2-desc"'));
  assert.ok(svg.includes('<title id="model-2-title">'));
  assert.ok(svg.includes('<desc id="model-2-desc">'));
  assert.doesNotMatch(svg,/<script|<image|<foreignObject|https:\/\/(?!www\.w3\.org)/i);
  assert.ok(svg.length<500_000,'bounded SVG output');
});
