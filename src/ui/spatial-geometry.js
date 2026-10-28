/** Local concept geometry; dimensions are invented model units, never survey data. */
const PALETTE = Object.freeze({wall: '#ddd8c9', roof: '#f1eee3', glass: '#63938e', trim: '#456b63', wood: '#b58a59', green: '#8fae81', ground: '#e1e7d8', path: '#c8cbbd', active: '#c58b35'});
export const SPATIAL_TOPICS = Object.freeze([
  Object.freeze({id: 'outdoor_learning', label: '외부학습공간', layoutLabel: '테라스 중정형', space: '열린 중정 · 야외 교실 · 낮은 테라스',
    designMoves: Object.freeze(['낮은 교사동으로 중정 감싸기', '학습 데크와 계단형 야외 교실', '녹화 테라스와 그늘 쉼터']),
    interpretation: '높이가 다른 교사동을 중정 주위에 배치하고, 가운데 넓은 학습 데크와 계단형 야외 교실을 둡니다. 낮은 지붕의 테라스와 열린 그늘막이 실내외 활동을 연결합니다.',
    alternative: '뒤쪽 두 층 교사동과 양옆의 낮은 교사동이 열린 중정을 감쌉니다. 가운데는 나무 데크·잔디·계단형 좌석, 앞쪽은 기둥과 들보만 있는 그늘막입니다. 오른쪽 작은 실내 학습실의 지붕과 앞벽을 투과하면 가구를 볼 수 있습니다.',
    assumption: '기후·소음·관리 동선과 실제 수업 운영은 검증하지 않았습니다.', point: [0, 0.7, -1]}),
  Object.freeze({id: 'community_sharing', label: '지역공유', layoutLabel: '학교·주민시설 분리형', space: '독립 도서관 · 주민 체육관 · 공유 광장',
    designMoves: Object.freeze(['뒤쪽에 학생 교사동 모으기', '거리 쪽 도서관·체육관 분리', '공유 광장과 두 진입 동선']),
    interpretation: '학생 교사동은 뒤쪽에 모으고, 거리 쪽에 독립된 도서관과 주민 체육관을 배치합니다. 두 시설 사이의 광장으로 주민이 들어오며 학생 진입로는 오른쪽으로 분리합니다.',
    alternative: '뒤쪽은 세 층의 큰 교사동, 앞쪽 왼편은 낮은 도서관, 오른편은 높고 넓은 체육관입니다. 두 주민시설 사이에 공유 광장이 있고 오른쪽 가장자리의 학생 진입로와 구분됩니다. 투과를 높이면 도서관 서가와 체육관 바닥이 드러납니다.',
    assumption: '운영 시간·이용 권한·피난·보안 성능은 검증하지 않았습니다.', point: [0, 0.15, -7]}),
  Object.freeze({id: 'flexible_learning', label: '가변학습공간', layoutLabel: '학습동 군집형', space: '중앙 공용홀 · 학습 모듈 · 연결 통로',
    designMoves: Object.freeze(['작은 학습동을 나누어 배치', '중앙 공용홀과 연결 통로', '모듈 내부 이동식 구획']),
    interpretation: '작은 학습동을 중앙 공용홀 주변에 나누어 놓고 연결 통로로 묶습니다. 각 모듈 안의 모둠 가구와 이동식 구획으로 활동 규모를 달리하는 개념입니다.',
    alternative: '가운데 높은 공용홀 주변으로 네 개의 낮은 학습동이 떨어져 배치되고 짧은 통로가 연결합니다. 뒤쪽에는 두 층의 교사동이 있습니다. 투과를 높이면 학습동의 이동식 구획과 모둠 가구, 공용홀의 모둠 작업대가 보입니다.',
    assumption: '구조·음향·수용 인원·학습 효과는 검증하지 않았습니다.', point: [0, 5.4, 0]}),
]);

export const SPATIAL_MODEL = Object.freeze({
  model_id: 'keyword-campus-concepts-02', type: 'fictional_concept', label: '가상 학교 공간 개념 모델',
  creator: 'yunze', date: '2026-10-28',
  source: '직접 작성한 공간 구성과 형상 · 외부 도면/사진 미사용',
  rights: '자체 제작 개념도 · 별도 공개 라이선스 미정, 외부 재사용 조건 확인 필요',
  assumptions: '치수·배치·재료는 설명용 가정입니다. 실제 학교 재현·BIM·성능 검증·미래 예측이 아닙니다.',
});

const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalizeSpatialView(state = {}) {
  return {angle: clamp(state.angle, -180, 180, 32), zoom: clamp(state.zoom, 80, 130, 100),
    transparency: clamp(state.transparency ?? (state.cutaway === true ? 100 : 0), 0, 100, 0)};
}

/** Each keyword has its own campus, with a shared site and camera for comparison. */
export function createSpatialGeometry(view = {}, topicId = 'outdoor_learning') {
  const topic = SPATIAL_TOPICS.find(item => item.id === topicId)?.id ?? SPATIAL_TOPICS[0].id;
  const {transparency}=normalizeSpatialView(view);
  const faces = [];
  let layer='site',enclosure=false,feature='site';
  function face(points, color, topic = null) {
    faces.push({points, color, topic, layer, feature, enclosure, opacity: enclosure ? 1-transparency/100 : 1});
  }
  function box(x, y, z, w, h, d, color, topic = null, topColor = null) {
    const a = [x,y,z], b = [x+w,y,z], c = [x+w,y,z+d], e = [x,y,z+d];
    const f = [x,y+h,z], g = [x+w,y+h,z], j = [x+w,y+h,z+d], k = [x,y+h,z+d];
    face([a,b,g,f], color, topic); face([b,c,j,g], color, topic);
    face([c,e,k,j], color, topic); face([e,a,f,k], color, topic);
    face([f,g,j,k], topColor ?? color, topic);
  }
  box(-20,-0.45,-16,40,0.45,33,PALETTE.ground);
  box(-19,0,-14,38,0.04,2.5,PALETTE.path);
  layer='building';

  function schoolBlock(x,z,w,d,floors=2) {
    feature='main_school';
    const height=floors*3+0.5;
    box(x,0.1,z,w,height,d,PALETTE.wall,null,PALETTE.roof);
    for(let floor=0;floor<floors;floor++) {
      const y=0.7+floor*3;
      for(let px=x+0.65;px<x+w-0.7;px+=1.75) {
        box(px,y,z-0.035,1.12,1.95,0.05,PALETTE.glass);
        box(px+0.53,y,z-0.07,0.06,1.95,0.08,PALETTE.trim);
        box(px,y,z+d-0.01,1.12,1.95,0.05,PALETTE.glass);
      }
      for(let pz=z+0.7;pz<z+d-0.8;pz+=1.8) {
        box(x-0.04,y,pz,0.06,1.95,1.15,PALETTE.glass);
        box(x+w-0.02,y,pz,0.06,1.95,1.15,PALETTE.glass);
      }
      box(x-0.15,y-0.28,z-0.18,w+0.3,0.13,d+0.36,'#ece9df');
    }
    box(x-0.23,height+0.1,z-0.23,w+0.46,0.22,d+0.46,PALETTE.roof);
    box(x+0.5,height+0.35,z+0.5,w-1,0.08,d-1,'#b4bcb0');
  }

  function pavilion(x,z,w,d,kind='learning_pod',height=3.2) {
    feature=kind;
    box(x,0.1,z,w,0.24,d,PALETTE.wall,topic);
    box(x,0.34,z+d-0.14,w,height,0.14,PALETTE.wall,topic);
    for(let px=x+0.2;px<x+w;px+=1.5) box(px,0.34,z+d-0.3,0.13,height-0.02,0.15,PALETTE.wood,topic);
    enclosure=true;
    if(transparency<100) {
      box(x,0.34,z,w,height-0.25,0.06,PALETTE.glass,topic);
      box(x,0.34,z,0.06,height-0.25,d,PALETTE.glass,topic);
      box(x+w-0.06,0.34,z,0.06,height-0.25,d,PALETTE.glass,topic);
      for(let px=x;px<x+w;px+=1.5) box(px,0.34,z-0.05,0.09,height,0.12,PALETTE.wood,topic);
      box(x-0.35,height+0.34,z-0.35,w+0.7,0.22,d+0.7,PALETTE.roof,topic);
      if(kind==='commons') box(x+1,height+0.57,z+1,w-2,0.38,d-2,'#8faca4',topic);
      if(kind==='gym') {
        for(let offset=0;offset<3;offset++) box(x+1+offset*(w-2)/3,height+0.58,z+1,0.6,0.22,d-2,'#a4bab2',topic);
      }
    }
    enclosure=false;
    feature='interior';
    if(kind==='gym') {
      box(x+0.6,0.35,z+0.6,w-1.2,0.06,d-1.2,'#c5a16e',topic);
      // Court lines remain geometry, not an image or an inferred regulation-size court.
      for(const edgeX of [x+1,x+w-1.08]) box(edgeX,0.415,z+1,0.08,0.01,d-2,'#f4f1df',topic);
      for(const edgeZ of [z+1,z+d/2,z+d-1.08]) box(x+1,0.415,edgeZ,w-2,0.01,0.08,'#f4f1df',topic);
      return;
    }
    const tableCount=kind==='commons'?4:2;
    for(let i=0;i<tableCount;i++) {
      const px=x+0.7+(i%2)*(w/2), pz=z+1.1+Math.floor(i/2)*2.2;
      box(px,0.75,pz,1.6,0.12,0.95,PALETTE.wood,topic);
      box(px+0.65,0.34,pz+0.4,0.12,0.41,0.12,PALETTE.trim,topic);
    }
    if(kind==='library') {
      for(let i=0;i<4;i++) {
        const px=x+0.6+i*(w-1.5)/4;
        box(px,0.35,z+d-1.1,1.25,1.8,0.45,PALETTE.wood,topic);
        for(let shelf=0;shelf<3;shelf++) box(px+0.1,0.65+shelf*0.48,z+d-1.22,1.03,0.21,0.13,PALETTE.glass,topic);
      }
    } else {
      box(x+w/2,0.35,z+d-2.2,0.13,2,1.6,'#b1bda6',topic);
      box(x+w/2+0.15,0.35,z+d-0.8,w/2-0.65,2,0.13,'#b1bda6',topic);
    }
  }

  function rail(x,y,z,w,d) {
    for(let px=x;px<=x+w;px+=1.5) box(px,y,z,0.1,0.8,0.1,PALETTE.trim,topic);
    box(x,y+0.75,z,w+0.1,0.08,0.1,PALETTE.trim,topic);
    if(d>0) {
      for(let pz=z;pz<=z+d;pz+=1.5) box(x,y,pz,0.1,0.8,0.1,PALETTE.trim,topic);
      box(x,y+0.75,z,0.1,0.08,d,PALETTE.trim,topic);
    }
  }
  function coveredLink(x,z,w,d,height=2.7) {
    feature='connection';
    box(x,0.1,z,w,0.16,d,'#becab8',topic);
    for(const px of [x,x+w-0.1]) for(const pz of [z,z+d-0.1]) box(px,0.2,pz,0.1,height,0.1,PALETTE.trim,topic);
    box(x-0.1,height+0.2,z-0.1,w+0.2,0.12,d+0.2,'#d6dfd0',topic);
  }
  function tree(x,z,size=1) {
    feature='planting';
    box(x-0.13,0,z-0.13,0.26,2.4*size,0.26,PALETTE.wood);
    const y=2.5*size, r=1.25*size, height=2.3*size;
    const base=[[x-r,y,z],[x,y,z-r],[x+r,y,z],[x,y,z+r]], top=[x,y+height,z];
    for(let i=0;i<4;i++) face([base[i],base[(i+1)%4],top],['#789777','#91ae83','#7e9e78','#a0b991'][i]);
  }

  if(topic==='outdoor_learning') {
    layer='site';feature='outdoor_deck';
    box(-8.2,0.05,-6,16.4,0.22,13,PALETTE.wood,topic);
    for(let i=0;i<33;i++) box(-8.2+i*0.5,0.275,-6,0.025,0.012,13,'#9e7b50',topic);
    box(-2.5,0.3,-2,5,0.14,4.6,PALETTE.green,topic);
    box(-2,0.02,-11.5,4,0.035,5.5,PALETTE.path);
    layer='building';
    schoolBlock(-13,8,26,4,2);
    schoolBlock(-13,-2.5,4.5,10.5,1);
    schoolBlock(8.5,3,4.5,5,1);
    pavilion(8.5,-5.5,4.5,8,'outdoor_studio');
    feature='roof_terrace';
    box(-12.4,3.98,-1.9,3.2,0.1,8.8,'#a8bb91',topic);
    rail(-13,3.9,-2.5,4.5,10.3);
    feature='teaching_steps';
    for(let step=0;step<5;step++) box(-6.5,0.3+step*0.28,3+step*0.65,9,0.28,0.65,'#c7a274',topic);
    feature='pergola';
    for(const x of [-7.5,-1]) for(const z of [-7.2,-4]) box(x,0.2,z,0.15,3.05,0.15,PALETTE.wood,topic);
    for(let i=0;i<9;i++) box(-7.6+i*0.85,3.25,-7.4,0.14,0.2,3.8,PALETTE.wood,topic);
    box(-7.6,3.1,-7.2,7,0.2,0.15,PALETTE.trim,topic);
    box(-7.6,3.1,-4,7,0.2,0.15,PALETTE.trim,topic);
    for(const [x,z,s] of [[-17,6,1.1],[-17,-4,0.85],[17,6,1.1],[16,-6,0.8],[-3.8,-0.8,0.55],[4.9,0.5,0.65],[-15,14,0.8],[14,14,0.9]]) tree(x,z,s);
  } else if(topic==='community_sharing') {
    layer='site';feature='public_plaza';
    box(-3.5,0.05,-11.5,7,0.08,14,'#d3c7b1',topic);
    for(let i=0;i<8;i++) box(-3.5,0.14,-11+i*1.6,7,0.012,0.025,'#b8ad9c',topic);
    feature='student_entry';
    box(15,0.06,-11.5,2.5,0.09,23.5,'#adc3b9',topic);
    box(-14,0.05,0.8,28,0.04,2.2,PALETTE.path);
    layer='building';
    schoolBlock(-7,5,21,7,3);
    schoolBlock(-14,5,6,7,2);
    pavilion(-14,-10.5,10,7,'library',3.2);
    pavilion(4,-10.5,9.5,10,'gym',5.2);
    feature='entry_canopy';
    coveredLink(-3,1,6,3,2.5);
    feature='boundary';
    for(const [x,w] of [[-14,10],[4,10]]) {
      for(let px=x;px<x+w;px+=1.5) box(px,0.1,3.5,0.1,1.15,0.1,PALETTE.trim,topic);
      box(x,1.15,3.5,w,0.1,0.1,PALETTE.wood,topic);
    }
    feature='seating';
    for(const z of [-8,-4]) box(-2.8,0.14,z,0.6,0.45,2,PALETTE.wood,topic);
    for(const [x,z,s] of [[-17,-8,0.9],[-17,1,1.05],[18,8,0.9],[1,-8,0.65],[1,-3,0.65],[-15,14,0.8],[14,14,0.8]]) tree(x,z,s);
  } else {
    layer='site';feature='learning_gardens';
    box(-15,0.05,-10,30,0.08,20,'#c8d6bf',topic);
    box(-3.5,0.14,-11.5,7,0.04,23.5,PALETTE.path);
    box(-15,0.14,-1.4,30,0.04,2.8,PALETTE.path);
    layer='building';
    schoolBlock(-5,10.4,16,4.1,2);
    pavilion(-3.8,-3.8,7.6,7.6,'commons',4.5);
    pavilion(-13.2,-9.5,6.7,6,'learning_pod');
    pavilion(6.5,-8.5,6.7,6,'learning_pod');
    pavilion(-13.2,3.5,6.7,6,'learning_pod');
    pavilion(6.5,3.5,6.7,6,'learning_pod');
    coveredLink(-6.5,-5.8,2.7,2.5);
    coveredLink(3.8,-4.8,2.7,2.5);
    coveredLink(-6.5,3,2.7,2.5);
    coveredLink(3.8,3,2.7,2.5);
    coveredLink(-1.3,3.8,2.6,6.6);
    for(const [x,z,s] of [[-17,9,0.9],[-17,-4,0.9],[17,9,0.9],[17,-5,0.9],[-9,0.2,0.65],[9,0.5,0.65],[-9,14,0.8]]) tree(x,z,s);
  }
  return faces;
}

export function projectSpatialPoint([x,y,z], view={}) {
  const {angle,zoom}=normalizeSpatialView(view), theta=angle*Math.PI/180, tilt=0.55;
  const xr=x*Math.cos(theta)+z*Math.sin(theta), zr=-x*Math.sin(theta)+z*Math.cos(theta);
  // One common camera frames every layout even at 130% and any rotation.
  // The full building set has vertical camera-space bounds [-10.821, 18.180];
  // 10.6 * 1.3 keeps it within y=9..410, above the caption at y=440.
  const scale=10.6*zoom/100;
  // Screen-up and depth form an orthogonal camera basis; farther ground points move upward.
  return {x:400+xr*scale,y:260-(zr*Math.sin(tilt)+y*Math.cos(tilt))*scale,depth:zr*Math.cos(tilt)-y*Math.sin(tilt)};
}

/** Site surfaces must be painted first: their average depth can otherwise cover entire buildings. */
export function projectSpatialFaces(view={}, topicId='outdoor_learning') {
  return createSpatialGeometry(view,topicId).map(face=>{
    const projected=face.points.map(point=>projectSpatialPoint(point,view));
    return {...face,projected,depth:projected.reduce((sum,p)=>sum+p.depth,0)/projected.length};
  }).filter(face=>{
    // The boxes use inward winding. A negative projected area is the outward-visible face.
    const [a,b,c]=face.projected;
    return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<-0.001;
  }).sort((a,b)=>Number(a.layer==='building')-Number(b.layer==='building') || b.depth-a.depth);
}

function svgScene(view, topic) {
  const polygons=projectSpatialFaces(view,topic.id).map(face=>`<polygon points="${face.projected.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="${face.color}" opacity="${face.opacity}" stroke="${face.topic===topic.id?'#92703b':'#47564c'}" stroke-opacity="${face.topic===topic.id?'.28':'.13'}" stroke-width=".45"/>`).join('');
  const p=projectSpatialPoint(topic.point,view);
  const marker=`<g aria-hidden="true"><line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${p.y-40}" stroke="#8c5b1c" stroke-width="2"/><circle cx="${p.x}" cy="${p.y}" r="7" fill="#dfb463" stroke="#fff" stroke-width="2"/><rect x="${p.x-72}" y="${p.y-67}" width="144" height="28" rx="5" fill="#fffaf0" stroke="#a57937"/><text x="${p.x}" y="${p.y-48}" text-anchor="middle" fill="#573c16" font-size="13" font-weight="700">${escapeXml(topic.label)}</text></g>`;
  return `<g>${polygons}${marker}</g>`;
}

/** Self-contained SVG: no remote images/fonts/scripts or source HTML. */
export function buildSpatialSvg({topicId='outdoor_learning',view={},report=null,idPrefix='spatial-image'}={}) {
  const topic=SPATIAL_TOPICS.find(item=>item.id===topicId)??SPATIAL_TOPICS[0];
  const normal=normalizeSpatialView(view);
  const lines=report ? [
    `${SPATIAL_MODEL.label} · ${topic.label} · ${topic.layoutLabel}`, `공간: ${topic.space}`,
    `배치의 특징: ${topic.designMoves.join(' / ')}`,
    `제작: ${SPATIAL_MODEL.creator} · 기준일: ${SPATIAL_MODEL.date}`,
    `형상 출처: ${SPATIAL_MODEL.source}`, `이용 조건: ${SPATIAL_MODEL.rights}`,
    `자료 범위: ${report.scopeLabel || '현재 조회 조건'} · 연결 사업 ${report.projectIds?.length ?? 0}건`,
    `키워드 근거: ${(report.sourceIds ?? []).join(', ') || '연결된 출처 없음'}`,
    ...[...new Map((report.sources ?? []).map(source=>[source.source_id,source])).values()].map(source=>`${source.source_id}: ${source.title} · ${source.url || '원문 링크 없음'}`),
    `근거 자료: ${report.is_demo ? '가상 자료' : '수집 자료'} · 출처 연결 미확인 ${report.missingSourceCount ?? 0}건`,
    '근거는 키워드 분류용이며 이 학교 형상·치수의 출처가 아닙니다.',
    SPATIAL_MODEL.assumptions, `추가 가정: ${topic.assumption}`,
  ] : [];
  const wrapped=lines.flatMap(line=>Array.from(String(line)).reduce((rows,char,i)=>{if(i%58===0)rows.push('');rows[rows.length-1]+=char;return rows;},[]));
  const height=report ? 490+wrapped.length*23 : 470;
  const prefix=String(idPrefix).replace(/[^a-zA-Z0-9_-]/g,'') || 'spatial-image';
  const metadata={...SPATIAL_MODEL,topic_id:topic.id,layout_id:`${SPATIAL_MODEL.model_id}-${topic.id}`,layout_label:topic.layoutLabel,design_moves:topic.designMoves,space:topic.space,interpretation:topic.interpretation,topic_assumption:topic.assumption,view:normal,...(report ? {report} : {})};
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 ${height}" role="img" aria-labelledby="${prefix}-title ${prefix}-desc"><title id="${prefix}-title">${escapeXml(`${topic.label} · ${topic.layoutLabel} · 가상 학교 공간 모델`)}</title><desc id="${prefix}-desc">${escapeXml(`${topic.alternative} ${SPATIAL_MODEL.assumptions}`)}</desc><metadata>${escapeXml(JSON.stringify(metadata))}</metadata><rect width="800" height="${height}" fill="#f2f5ec"/><g font-family="Malgun Gothic,Arial,sans-serif">${svgScene(normal,topic)}<text x="24" y="440" fill="#39594d" font-size="13">${escapeXml(topic.layoutLabel)} · 가상 배치 제안 · 실제 학교 재현 아님</text>${wrapped.map((line,i)=>`<text x="24" y="${485+i*23}" fill="#233f36" font-size="13">${escapeXml(line)}</text>`).join('')}</g></svg>`;
}
