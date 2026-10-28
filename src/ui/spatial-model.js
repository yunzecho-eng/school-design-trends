import {el, safeUrl} from './dom.js';
import {buildSpatialSvg, normalizeSpatialView, SPATIAL_MODEL, SPATIAL_TOPICS} from './spatial-geometry.js';
export {SPATIAL_MODEL, SPATIAL_TOPICS} from './spatial-geometry.js';

const list = value => Array.isArray(value) ? value : [];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, fallback='미확인') => typeof value === 'string' && value.trim() ? value : fallback;
const reviewLabels = new Map([['demo','가상 자료'],['checked','확인'],['reviewed','검토 완료'],['verified','확인됨으로 기재'],['draft','초안'],['draft_ai','AI 분류 초안 · 사람 검토 전'],['manual_entry','수작업 입력'],['unknown','미확인']]);
const instances = new WeakMap();
let nextInstance=0;

/** Only supplied (already filtered) projects may provide evidence. Never fill from all snapshot projects. */
export function spatialEvidence(projects, snapshot, topicId) {
  const sources = new Map(list(snapshot?.sources).filter(record).map(source => [source.source_id,source]));
  const unique = new Map(list(projects).filter(project => record(project) && typeof project.project_id === 'string')
    .map(project=>[project.project_id,project]));
  const matches=[];
  if(SPATIAL_TOPICS.some(topic=>topic.id===topicId)) for(const project of unique.values()) {
    const evidence=list(project.topic_evidence).filter(item=>record(item) && item.topic_id===topicId).map(item=>{
      const source=sources.get(item.source_id);
      return {source_id: typeof item.source_id==='string'?item.source_id:null,
        note:text(item.evidence_note,'근거 설명 미확인'),review_status:text(item.review_status,'unknown'),
        source:source ? {source_id:source.source_id,title:text(source.title,'출처 제목 미확인'),url:safeUrl(source.url),
          publisher:text(source.publisher),published_at:text(source.published_at),verification_status:text(source.verification_status,'unknown')} : null};
    });
    if(evidence.length) matches.push({project,evidence});
  }
  return {denominator:unique.size,matches,sourceIds:[...new Set(matches.flatMap(item=>item.evidence.filter(e=>e.source).map(e=>e.source_id)))],
    missingSources:matches.reduce((sum,item)=>sum+item.evidence.filter(e=>!e.source).length,0)};
}

/** Optional, lazy concept panel. Topic selection preserves view; no frame loop or external requests. */
export function renderSpatialModel(container, {
  projects=[],snapshot={},onOpenProject=()=>{},selectedTopic,scopeLabel='현재 조회 조건',
}={}) {
  instances.get(container)?.destroy();
  const previous=container.dataset;
  const savedTopic=SPATIAL_TOPICS.find(topic=>topic.id===selectedTopic)?.id
    ?? SPATIAL_TOPICS.find(topic=>topic.id===previous.spatialTopic)?.id
    ?? SPATIAL_TOPICS.find(topic=>spatialEvidence(projects,snapshot,topic.id).matches.length)?.id
    ?? SPATIAL_TOPICS[0].id;
  const state={topic:savedTopic,...normalizeSpatialView({angle:previous.spatialAngle??32,zoom:previous.spatialZoom??100,transparency:previous.spatialTransparency??0})};
  const idPrefix=`spatial-instance-${++nextInstance}`;
  let initialized=false,destroyed=false,drawModel,drawText,topics,download;
  const root=el('details',{class:'spatial-panel'});
  const summary=el('summary',{},[el('strong',{},'키워드를 공간으로 이해하기'),el('span',{},'가상 학교 · 3D 개념 비교 펼치기')]);
  const content=el('div',{class:'spatial-content'});
  root.append(summary,content);container.replaceChildren(root);

  function save() {
    Object.assign(container.dataset,{spatialTopic:state.topic,spatialAngle:String(state.angle),spatialZoom:String(state.zoom),spatialTransparency:String(state.transparency),spatialOpen:String(root.open)});
  }
  function updateTopic(id) {
    if(destroyed || !SPATIAL_TOPICS.some(topic=>topic.id===id)) return;
    state.topic=id;save();
    if(initialized) {drawText();drawModel();}
  }
  function initialize() {
    if(initialized || destroyed) return;
    initialized=true;
    content.append(el('p',{class:'spatial-scope'},scopeLabel),
      el('p',{class:'spatial-disclaimer'},'가상 학교 개념도 · 실제 사례의 건물 형상과 다릅니다.'));
    topics=el('div',{class:'spatial-topic-controls',role:'group','aria-label':'키워드별 학교 배치 비교'});
    for(const topic of SPATIAL_TOPICS) {
      const button=el('button',{type:'button','data-topic':topic.id},[
        el('strong',{},topic.label),el('span',{},topic.layoutLabel),
      ]);
      button.addEventListener('click',()=>updateTopic(topic.id));topics.append(button);
    }
    const layout=el('div',{class:'spatial-layout'}),visual=el('div',{class:'spatial-visual'});
    const stage=el('div',{class:'spatial-stage','aria-label':'가상 학교 3D 공간 개념도'});
    const fallback=el('p',{class:'notice',role:'status',hidden:true},'공간 그림을 표시할 수 없습니다. 아래 공간 설명과 근거 사례를 확인하세요.');
    const controls=el('div',{class:'spatial-view-controls'});
    const rotation=el('input',{type:'range',min:-180,max:180,step:4,value:state.angle,'aria-label':'공간 모델 회전 각도'});
    const rotationValue=el('output',{},`${state.angle}°`);
    const zoom=el('input',{type:'range',min:80,max:130,step:5,value:state.zoom,'aria-label':'공간 모델 확대 비율'});
    const zoomValue=el('output',{},`${state.zoom}%`);
    const transparency=el('input',{type:'range',min:0,max:100,step:5,value:state.transparency,'aria-label':'선택한 공간의 내부 투과율'});
    const transparencyValue=el('output',{},`${state.transparency}%`);
    const exterior=el('button',{type:'button',class:'spatial-action'},'전체 외관');
    const interior=el('button',{type:'button',class:'spatial-action'},'내부 보기');
    const reset=el('button',{type:'button',class:'spatial-action'},'시점 초기화');
    controls.append(el('label',{},['회전',rotation,rotationValue]),el('label',{},['확대',zoom,zoomValue]),
      el('label',{class:'spatial-transparency'},['내부 투과',transparency,transparencyValue]),
      el('div',{class:'spatial-view-presets'},[exterior,interior,reset]));
    const narrative=el('div',{class:'spatial-narrative'}),evidenceList=el('div',{class:'spatial-evidence'});
    const status=el('p',{class:'sr-only',role:'status','aria-live':'polite'});
    download=el('button',{type:'button',class:'spatial-action'},'보고서용 개념도 저장 (SVG)');
    const downloadStatus=el('p',{class:'small',role:'status'});
    const alternativeText=el('p');
    const alternative=el('details',{class:'spatial-alternative'},[
      el('summary',{},'그림 대신 공간 설명 읽기'),
      alternativeText,
    ]);
    visual.append(stage,fallback,controls,el('p',{class:'small'},'내부 투과를 높이면 선택한 공용 공간의 지붕·외벽이 옅어집니다. 주요 교사동은 유지됩니다. 방향키로도 조절할 수 있습니다.'),alternative,download,downloadStatus);
    layout.append(visual,narrative);content.append(topics,
      el('p',{class:'spatial-comparison-note'},'같은 부지 크기와 시점에서 배치 3안을 비교합니다. 키워드를 바꾸면 건물 형태와 공간 구성이 함께 달라집니다.'),status,layout,evidenceList,
      el('details',{class:'spatial-credits'},[el('summary',{},'모델 출처 · 이용 조건 · 가정'),
        el('p',{},`${SPATIAL_MODEL.creator} · ${SPATIAL_MODEL.date} · ${SPATIAL_MODEL.model_id}`),
        el('p',{},SPATIAL_MODEL.source),el('p',{},SPATIAL_MODEL.rights),el('p',{},SPATIAL_MODEL.assumptions),
        el('p',{},'현재는 형상을 생성하는 규칙을 직접 작성한 단계입니다. 실제 자료 자동 수집·AI 학습·도면 변환은 연결하지 않았습니다. 모델은 사업 집계와 다운로드의 건수를 바꾸지 않습니다.') ]));
    function changed() {
      save();rotationValue.textContent=`${state.angle}°`;zoomValue.textContent=`${state.zoom}%`;transparencyValue.textContent=`${state.transparency}%`;
      exterior.setAttribute('aria-pressed',String(state.transparency===0));interior.setAttribute('aria-pressed',String(state.transparency===100));
      transparency.setAttribute('aria-valuetext',`${state.transparency}%${state.transparency===0?' · 전체 외관':state.transparency===100?' · 내부 구조':''}`);
      drawModel();
    }
    rotation.addEventListener('input',()=>{state.angle=Number(rotation.value);changed();});
    zoom.addEventListener('input',()=>{state.zoom=Number(zoom.value);changed();});
    transparency.addEventListener('input',()=>{state.transparency=Number(transparency.value);changed();});
    exterior.addEventListener('click',()=>{state.transparency=0;state.angle=32;state.zoom=100;transparency.value='0';rotation.value='32';zoom.value='100';changed();});
    interior.addEventListener('click',()=>{state.transparency=100;transparency.value='100';changed();});
    reset.addEventListener('click',()=>{state.angle=32;state.zoom=100;rotation.value='32';zoom.value='100';changed();});
    drawModel=()=>{
      try {
        const svg=new DOMParser().parseFromString(buildSpatialSvg({topicId:state.topic,view:state,idPrefix}),'image/svg+xml');
        if(svg.querySelector('parsererror')) throw new Error('Invalid SVG');
        stage.replaceChildren(svg.documentElement);fallback.hidden=true;
      } catch {stage.replaceChildren();fallback.hidden=false;}
    };
    drawText=()=>{
      const topic=SPATIAL_TOPICS.find(item=>item.id===state.topic),evidence=spatialEvidence(projects,snapshot,state.topic);
      for(const button of topics.children) button.setAttribute('aria-pressed',String(button.dataset.topic===state.topic));
      alternativeText.textContent=topic.alternative;
      narrative.replaceChildren(el('p',{class:'eyebrow'},'이 배치의 차이'),el('h4',{},topic.layoutLabel),
        el('ul',{class:'spatial-design-moves'},topic.designMoves.map(move=>el('li',{},move))),
        el('details',{class:'spatial-assumptions'},[el('summary',{},'설계 의도 · 해석의 범위'),el('p',{},topic.interpretation),el('p',{class:'small'},topic.assumption),
          el('p',{class:'small'},'가상 개념 모델입니다. 키워드 빈도·학습 효과·미래 수요를 형상에서 추론하지 않습니다.')]));
      status.textContent=`${topic.label}: ${topic.layoutLabel} 배치. 현재 조건의 연결 사업 ${evidence.matches.length}건.`;
      evidenceList.replaceChildren(el('h4',{},'현재 조건의 키워드 근거 사례'),
        el('p',{class:'small'},`조회 사업 ${evidence.denominator}건 중 ${topic.label} 기록 ${evidence.matches.length}건. 키워드 분류 근거이며 위 가상 학교 형상의 근거가 아닙니다.`));
      if(snapshot.is_demo) evidenceList.append(el('p',{class:'small'},'가상 자료의 연결 예시입니다. 실제 최근 유행을 나타내지 않습니다.'));
      if(!evidence.matches.length) evidenceList.append(el('p',{class:'notice'},'현재 조건에 이 키워드의 근거 사례가 없습니다. 그림은 개념 설명으로만 제공하며 다른 연도·지역의 사례를 대신 연결하지 않습니다.'));
      const remainder=evidence.matches.length>3 ? el('details',{class:'spatial-more-evidence'},[
        el('summary',{},`나머지 근거 사례 ${evidence.matches.length-3}건 보기`),
      ]) : null;
      if(remainder) evidenceList.append(el('p',{class:'small'},'먼저 3건을 표시합니다. 나머지 사례를 펼쳐 전체 근거를 확인할 수 있습니다.'));
      for(const [index,{project,evidence:items}] of evidence.matches.entries()) {
        const projectButton=el('button',{type:'button',class:'text-button'},text(project.title,project.project_id));
        projectButton.addEventListener('click',()=>onOpenProject(project));
        const card=el('article',{class:'spatial-evidence-card'},[el('h5',{},projectButton)]);
        for(const item of items) {
          const entry=el('div',{class:'spatial-evidence-entry'},[el('p',{},item.note),el('p',{class:'small'},`분류 검토: ${reviewLabels.get(item.review_status)??item.review_status}`)]);
          if(!item.source) entry.append(el('p',{class:'small'},`근거 출처 연결 미확인${item.source_id?` · ${item.source_id}`:''}`));
          else {
            const source=item.source;
            entry.append(source.url ? el('a',{href:source.url,target:'_blank',rel:'noopener noreferrer',referrerpolicy:'no-referrer'},`${source.title} ↗`) : el('span',{class:'small'},`${source.title} · 원문 링크 없음`),
              el('p',{class:'small'},`${source.publisher} · 게시일 ${source.published_at} · 출처 상태 ${reviewLabels.get(source.verification_status)??source.verification_status}`));
          }
          card.append(entry);
        }
        (index<3 ? evidenceList : remainder).append(card);
      }
      if(remainder)evidenceList.append(remainder);
    };
    download.addEventListener('click',()=>{
      try {
        const evidence=spatialEvidence(projects,snapshot,state.topic);
        const report={scopeLabel,projectIds:evidence.matches.map(item=>item.project.project_id),sourceIds:evidence.sourceIds,
          sources:evidence.matches.flatMap(item=>item.evidence.filter(e=>e.source).map(e=>e.source)),
          is_demo:snapshot.is_demo===true,missingSourceCount:evidence.missingSources};
        const svg=buildSpatialSvg({topicId:state.topic,view:state,report});
        const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
        const a=el('a',{href:url,download:`school-concept-${state.topic}.svg`});
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        downloadStatus.textContent='현재 시점의 개념도에 모델 성격·출처·이용 조건·가정을 포함해 저장했습니다.';
      } catch {downloadStatus.textContent='이미지를 저장할 수 없습니다. 화면의 공간 설명과 출처를 확인하세요.';}
    });
    drawText();changed();
  }
  root.addEventListener('toggle',()=>{save();if(root.open)initialize();});
  const api={setTopic(id){updateTopic(id);},destroy(){destroyed=true;}};
  instances.set(container,api);
  if(previous.spatialOpen==='true'){root.open=true;initialize();}
  return api;
}
