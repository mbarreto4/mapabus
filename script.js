const STORAGE_KEY = "mapabus_faculdade_v1";

let app = loadApp();
let currentSeat = null;
const undoStack = [];
const UNDO_LIMIT = 20;

function cloneState(value){
  return JSON.parse(JSON.stringify(value));
}

function pushUndo(label){
  undoStack.push({label:label||"Última alteração", app:cloneState(app)});
  if(undoStack.length>UNDO_LIMIT) undoStack.shift();
  updateUndoUI();
}

function updateUndoUI(){
  const btn=document.getElementById("undoBtn");
  if(!btn) return;
  btn.disabled=!undoStack.length;
  btn.title=undoStack.length ? `Desfazer: ${undoStack[undoStack.length-1].label}` : "Nenhuma alteração para desfazer";
}

function undoLastAction(){
  const item=undoStack.pop();
  if(!item){ toast("Não há alterações para desfazer.", true); return; }
  app=cloneState(item.app);
  selectedPassengerIds.clear();
  saveApp();
  renderAll();
  updateUndoUI();
  toast(`Desfeito: ${item.label}`, true);
}

function normalizeTravelMode(value, notes="", returnOnly=false){
  const raw=String(value||"").toLowerCase().trim();
  if(raw==="ida" || raw==="volta" || raw==="ambos") return raw;
  if(returnOnly || /somente\s+volta/i.test(notes||"")) return "volta";
  if(/somente\s+ida/i.test(notes||"")) return "ida";
  return "ambos";
}

function travelModeLabel(mode){
  mode=normalizeTravelMode(mode);
  if(mode==="ida") return "Só ida";
  if(mode==="volta") return "Só volta";
  return "Ida + volta";
}

function travelModeClass(mode){
  mode=normalizeTravelMode(mode);
  if(mode==="ida") return "travel-ida";
  if(mode==="volta") return "travel-volta";
  return "travel-both";
}

function notesForTravelMode(notes,mode){
  let clean=String(notes||"")
    .replace(/(?:\s*[•|-]?\s*)?somente\s+(ida|volta)/ig,"")
    .replace(/\s{2,}/g," ")
    .replace(/^[\s•|-]+|[\s•|-]+$/g,"")
    .trim();
  mode=normalizeTravelMode(mode);
  if(mode==="volta") clean=[clean,"Somente volta"].filter(Boolean).join(" • ");
  if(mode==="ida") clean=[clean,"Somente ida"].filter(Boolean).join(" • ");
  return clean;
}

function passengerTravelMode(p){
  return normalizeTravelMode(p?.travelMode,p?.notes||"");
}

function waitingTravelMode(p){
  return normalizeTravelMode(p?.travelMode,p?.notes||"",!!p?.returnOnly);
}

function isEligibleForDirection(person,direction){
  const mode=person?.seat!==undefined ? passengerTravelMode(person) : waitingTravelMode(person);
  if(direction==="ida") return mode!=="volta";
  if(direction==="volta") return mode!=="ida";
  return true;
}

function applyTravelModeStatus(passengerId,date,mode,resetActive=true){
  if(!date) date=currentDate();
  mode=normalizeTravelMode(mode);
  if(!app.daily[date]) app.daily[date]={};
  if(!app.daily[date][passengerId]) app.daily[date][passengerId]={ida:"pending",volta:"pending"};
  const st=app.daily[date][passengerId];
  if(mode==="volta"){
    st.ida="absent";
    if(resetActive && st.volta==="absent") st.volta="pending";
  }else if(mode==="ida"){
    st.volta="absent";
    if(resetActive && st.ida==="absent") st.ida="pending";
  }else if(resetActive){
    if(st.ida==="absent") st.ida="pending";
    if(st.volta==="absent") st.volta="pending";
  }
}

function setPassengerTravelModeManual(passengerId, mode, options={}){
  const p=app.passengers.find(x=>x.id===passengerId);
  if(!p) return false;
  mode=normalizeTravelMode(mode);
  const previous=passengerTravelMode(p);
  if(previous===mode) return true;

  if(!options.skipUndo) pushUndo(`uso de viagem de ${p.name}`);
  p.travelMode=mode;
  p.notes=notesForTravelMode(p.notes||"",mode);
  applyTravelModeStatus(p.id,currentDate(),mode,true);
  saveApp();
  renderAll();
  if(!options.silent) toast(`${p.name}: ${travelModeLabel(mode)}.`);
  return true;
}

function setWaitingTravelModeManual(waitingId, mode, options={}){
  const date=currentDate();
  const list=getWaitingList(date);
  const p=list.find(x=>x.id===waitingId);
  if(!p) return false;
  mode=normalizeTravelMode(mode);
  const previous=waitingTravelMode(p);
  if(previous===mode) return true;

  if(!options.skipUndo) pushUndo(`uso de viagem de ${p.name}`);
  p.travelMode=mode;
  p.returnOnly=mode==="volta";
  p.notes=notesForTravelMode(p.notes||"",mode);
  app.waitingLists[date]=sortWaitingList(list);
  saveApp();
  renderAll();
  if(!options.silent) toast(`${p.name}: ${travelModeLabel(mode)}.`);
  return true;
}

function normalizeSeatConfig(config){
  const raw=config&&typeof config==="object"?config:{};
  const disabled=[...new Set((Array.isArray(raw.disabled)?raw.disabled:[])
    .map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=49))].sort((a,b)=>a-b);
  const extraCount=Math.max(0,Math.min(20,Number.parseInt(raw.extraCount,10)||0));
  return {disabled,extraCount};
}

function configuredSeatNumbers(data=app){
  const cfg=normalizeSeatConfig(data?.seatConfig);
  const disabled=new Set(cfg.disabled);
  const seats=[];
  for(let i=1;i<=49;i++) if(!disabled.has(i)) seats.push(i);
  for(let i=1;i<=cfg.extraCount;i++) seats.push(49+i);
  return seats;
}

function configuredSeatSet(data=app){
  return new Set(configuredSeatNumbers(data));
}

function isSeatActive(seat,data=app){
  return configuredSeatSet(data).has(Number(seat));
}

function configuredCapacity(data=app){
  return configuredSeatNumbers(data).length;
}

function maxConfiguredSeatNumber(data=app){
  const cfg=normalizeSeatConfig(data?.seatConfig);
  return 49+cfg.extraCount;
}

let seatConfigDraft=null;

function openSeatConfigModal(){
  seatConfigDraft=cloneState(normalizeSeatConfig(app.seatConfig));
  renderSeatConfigEditor();
  document.getElementById("seatConfigModal")?.classList.add("show");
}

function closeSeatConfigModal(){
  document.getElementById("seatConfigModal")?.classList.remove("show");
  seatConfigDraft=null;
}

function renderSeatConfigEditor(){
  if(!seatConfigDraft) seatConfigDraft=cloneState(normalizeSeatConfig(app.seatConfig));
  const disabled=new Set(seatConfigDraft.disabled||[]);
  const grid=document.getElementById("seatConfigGrid");
  if(grid){
    grid.innerHTML=Array.from({length:49},(_,i)=>i+1).map(n=>{
      const active=!disabled.has(n);
      const occupied=!!passengerBySeat(n);
      return `<button type="button" class="seat-config-tile ${active?'active':'disabled'} ${occupied?'occupied':''}" onclick="toggleSeatConfigDraft(${n})">
        <span>${String(n).padStart(2,'0')}</span>
        <small>${active?'Ativa':'Desabilitada'}${occupied?' • ocupada':''}</small>
      </button>`;
    }).join('');
  }
  const base=49-disabled.size;
  const extra=Number(seatConfigDraft.extraCount)||0;
  const cap=base+extra;
  const capEl=document.getElementById("seatConfigCapacity"); if(capEl) capEl.textContent=cap;
  const baseEl=document.getElementById("seatConfigBaseCount"); if(baseEl) baseEl.textContent=base;
  const extraEl=document.getElementById("seatConfigExtraCountDisplay"); if(extraEl) extraEl.textContent=extra;
  const input=document.getElementById("seatConfigExtraCount"); if(input) input.value=extra;
}

function toggleSeatConfigDraft(seat){
  if(!seatConfigDraft) return;
  seat=Number(seat);
  const set=new Set(seatConfigDraft.disabled||[]);
  if(set.has(seat)) set.delete(seat); else set.add(seat);
  seatConfigDraft.disabled=[...set].sort((a,b)=>a-b);
  renderSeatConfigEditor();
}

function setAllBaseSeatsActive(active){
  if(!seatConfigDraft) return;
  seatConfigDraft.disabled=active?[]:Array.from({length:49},(_,i)=>i+1);
  renderSeatConfigEditor();
}

function setExtraSeatCount(value){
  if(!seatConfigDraft) return;
  seatConfigDraft.extraCount=Math.max(0,Math.min(20,Number.parseInt(value,10)||0));
  renderSeatConfigEditor();
}

function changeExtraSeatCount(delta){
  if(!seatConfigDraft) return;
  setExtraSeatCount((Number(seatConfigDraft.extraCount)||0)+Number(delta||0));
}

function waitingEntryFromPassenger(p,list){
  const group=(p.course||"Sem grupo").trim()||"Sem grupo";
  const priority=getGroupPriority(group);
  const mode=passengerTravelMode(p);
  const sameGroup=list.filter(w=>(w.group||"Sem grupo")===group);
  const existingGroupIndex=sameGroup.length?Number(sameGroup[0].groupIndex)||0:null;
  const maxGroupIndex=list.reduce((m,w)=>Math.max(m,Number(w.groupIndex)||0),-1);
  const groupIndex=existingGroupIndex!==null?existingGroupIndex:maxGroupIndex+1;
  const nextOrder=sameGroup.reduce((m,w)=>Math.max(m,Number(w.order)||0),0)+1;
  const manualActive=waitingManualOrderActive(list);
  const maxManual=list.reduce((m,w)=>Math.max(m,Number(w.manualOrder)||0),0);
  return {
    id:cryptoId(),name:p.name,group,priority,groupIndex,order:nextOrder,
    returnOnly:mode==="volta",travelMode:mode,manualOrder:manualActive?maxManual+1:undefined,
    phone:p.phone||"",pickup:p.pickup||"",notes:p.notes||""
  };
}

function saveSeatConfiguration(){
  if(!seatConfigDraft) return;
  const next=normalizeSeatConfig(seatConfigDraft);
  if(configuredCapacity({seatConfig:next})<1){
    toast("O ônibus precisa ter pelo menos uma poltrona ativa.",true);return;
  }
  const nextActive=configuredSeatSet({seatConfig:next});
  const affected=app.passengers.filter(p=>!nextActive.has(Number(p.seat)));
  if(affected.length){
    const names=affected.slice(0,6).map(p=>p.name).join(", ")+(affected.length>6?"…":"");
    if(!confirm(`${affected.length} aluno(s) estão em poltronas que deixarão de existir:\n\n${names}\n\nDeseja continuar e enviar esses alunos para a fila de espera?`)) return;
  }
  pushUndo("alteração da configuração de poltronas");
  const date=currentDate();
  if(!app.waitingLists) app.waitingLists={};
  let waiting=getWaitingList(date).slice();
  const affectedIds=new Set();
  affected.forEach(p=>{
    waiting.push(waitingEntryFromPassenger(p,waiting));
    affectedIds.add(p.id);
  });
  if(affectedIds.size){
    app.passengers=app.passengers.filter(p=>!affectedIds.has(p.id));
    Object.values(app.daily||{}).forEach(day=>affectedIds.forEach(id=>{if(day[id]) delete day[id];}));
  }
  app.waitingLists[date]=sortWaitingList(waiting);
  app.seatConfig=next;
  syncActiveBusSnapshot();
  saveApp();
  closeSeatConfigModal();
  renderAll();
  toast(`Configuração salva: ${configuredCapacity()} lugares ativos.`,true);
}

function migrateDataSet(data){
  if(!data) return;
  data.passengers=(data.passengers||[]).map(p=>({...p,travelMode:normalizeTravelMode(p.travelMode,p.notes||"")}));
  if(!data.waitingLists) data.waitingLists={};
  Object.keys(data.waitingLists).forEach(date=>{
    data.waitingLists[date]=(data.waitingLists[date]||[]).map(w=>({...w,travelMode:normalizeTravelMode(w.travelMode,w.notes||"",!!w.returnOnly)}));
  });
  if(!data.daily) data.daily={};
  if(!data.extraGroups) data.extraGroups={};
  if(!data.config) data.config={destination:"Faculdade",shift:"Noite",driverName:"Bonfim"};
  if(!data.config.driverName) data.config.driverName="Bonfim";
  data.seatConfig=normalizeSeatConfig(data.seatConfig);
}

function migrateAppData(){
  migrateDataSet(app);
  if(Array.isArray(app.buses)) app.buses.forEach(migrateDataSet);
}

function busSnapshotFromCurrent(){
  return {
    passengers:cloneState(app.passengers||[]),
    daily:cloneState(app.daily||{}),
    extraGroups:cloneState(app.extraGroups||{}),
    waitingLists:cloneState(app.waitingLists||{}),
    config:cloneState(app.config||{destination:"Faculdade",shift:"Noite",driverName:"Bonfim"}),
    seatConfig:cloneState(normalizeSeatConfig(app.seatConfig))
  };
}

function loadBusIntoCurrent(bus){
  const data=bus||{};
  app.passengers=cloneState(data.passengers||[]);
  app.daily=cloneState(data.daily||{});
  app.extraGroups=cloneState(data.extraGroups||{});
  app.waitingLists=cloneState(data.waitingLists||{});
  app.config=cloneState(data.config||{destination:"Faculdade",shift:"Noite",driverName:"Bonfim"});
  app.seatConfig=cloneState(normalizeSeatConfig(data.seatConfig));
  migrateDataSet(app);
}

function syncActiveBusSnapshot(){
  if(!Array.isArray(app.buses) || !app.buses.length || !app.activeBusId) return;
  const bus=app.buses.find(b=>b.id===app.activeBusId);
  if(!bus) return;
  Object.assign(bus,busSnapshotFromCurrent());
}

function ensureBusSystem(){
  if(!Array.isArray(app.buses)) app.buses=[];
  if(!app.buses.length){
    const first={id:"bus-1",name:"Ônibus 1",...busSnapshotFromCurrent()};
    app.buses.push(first);
    app.activeBusId=first.id;
    return;
  }
  if(!app.activeBusId || !app.buses.some(b=>b.id===app.activeBusId)) app.activeBusId=app.buses[0].id;
  const active=app.buses.find(b=>b.id===app.activeBusId);
  if(active) loadBusIntoCurrent(active);
}

function getActiveBus(){
  return (app.buses||[]).find(b=>b.id===app.activeBusId) || null;
}

function getNextBus(){
  const buses=app.buses||[];
  const currentIndex=buses.findIndex(b=>b.id===app.activeBusId);
  if(currentIndex<0 || currentIndex>=buses.length-1) return null;
  return buses[currentIndex+1];
}

function updateOverflowTransferButton(){
  const btn=document.getElementById("transferOverflowBtn");
  if(!btn) return;
  const next=getNextBus();
  if(!next){
    btn.textContent=(app.buses||[]).length<2 ? "Adicione um 2º ônibus" : "Sem próximo ônibus";
    btn.disabled=true;
    btn.title=(app.buses||[]).length<2 ? "Adicione outro ônibus para enviar os excedentes." : "Este é o último ônibus cadastrado.";
    return;
  }
  const qty=sortWaitingList(getWaitingList()).length;
  btn.disabled=qty===0;
  btn.textContent=qty ? `Enviar ${qty} excedente${qty===1?"":"s"} → ${next.name}` : `Enviar excedentes → ${next.name}`;
  btn.title=`Move os alunos restantes da fila para ${next.name}, preenchendo primeiro as poltronas livres.`;
}

function busFreeSeatNumbers(bus){
  const occupied=new Set((bus?.passengers||[]).map(p=>Number(p.seat)));
  return configuredSeatNumbers(bus).filter(n=>!occupied.has(n));
}

function travelStatusObject(mode){
  mode=normalizeTravelMode(mode);
  if(mode==="volta") return {ida:"absent",volta:"pending"};
  if(mode==="ida") return {ida:"pending",volta:"absent"};
  return {ida:"pending",volta:"pending"};
}

function transferWaitingToNextBus(){
  syncActiveBusSnapshot();
  const source=getActiveBus();
  const target=getNextBus();
  if(!source) return;
  if(!target){
    toast("Adicione outro ônibus antes de transferir os excedentes.",true);
    return;
  }

  const date=currentDate();
  const sourceList=sortWaitingList(cloneState((source.waitingLists||{})[date]||[]));
  if(!sourceList.length){
    toast(`${source.name} não possui alunos excedentes na fila.`,true);
    updateOverflowTransferButton();
    return;
  }

  migrateDataSet(target);
  const freeSeats=busFreeSeatNumbers(target);
  const targetWaiting=sortWaitingList(cloneState((target.waitingLists||{})[date]||[]));
  const targetNames=new Set([
    ...(target.passengers||[]).map(p=>normalizeName(p.name)),
    ...targetWaiting.map(p=>normalizeName(p.name))
  ]);
  const transferable=sourceList.filter(p=>!targetNames.has(normalizeName(p.name)));
  const duplicateCount=sourceList.length-transferable.length;
  const willSeat=Math.min(transferable.length,freeSeats.length);
  const willWait=Math.max(0,transferable.length-willSeat);

  let message=`Transferir ${transferable.length} aluno(s) excedente(s) de ${source.name} para ${target.name}?\n\n`+
    `${willSeat} irão diretamente para poltronas livres.\n`+
    `${willWait} ficarão na fila de espera de ${target.name}.`;
  if(duplicateCount) message+=`\n\n${duplicateCount} nome(s) já existem em ${target.name} e permanecerão na fila de ${source.name}.`;
  if(!confirm(message)) return;

  pushUndo(`transferência de excedentes de ${source.name} para ${target.name}`);

  if(!target.daily) target.daily={};
  if(!target.daily[date]) target.daily[date]={};
  if(!target.waitingLists) target.waitingLists={};

  const transferredIds=new Set();
  let seated=0;
  const movedToWaiting=[];

  transferable.forEach((person,index)=>{
    const mode=waitingTravelMode(person);
    if(index<freeSeats.length){
      const passengerId=cryptoId();
      target.passengers.push({
        id:passengerId,
        name:person.name,
        seat:freeSeats[index],
        phone:person.phone||"",
        course:person.group||"",
        pickup:person.pickup||"",
        notes:notesForTravelMode(person.notes||"",mode),
        travelMode:mode
      });
      target.daily[date][passengerId]=travelStatusObject(mode);
      seated++;
    }else{
      const clone={...person};
      delete clone.manualOrder;
      clone.travelMode=mode;
      clone.returnOnly=mode==="volta";
      movedToWaiting.push(clone);
    }
    transferredIds.add(person.id);
  });

  target.waitingLists[date]=sortWaitingList([...targetWaiting,...movedToWaiting]);
  source.waitingLists[date]=sourceList.filter(p=>!transferredIds.has(p.id));

  // Keep the active top-level snapshot aligned with the source bus.
  loadBusIntoCurrent(source);
  saveApp();
  renderAll();

  const parts=[];
  if(seated) parts.push(`${seated} alocado${seated===1?"":"s"} em poltronas`);
  if(movedToWaiting.length) parts.push(`${movedToWaiting.length} na fila de ${target.name}`);
  if(duplicateCount) parts.push(`${duplicateCount} mantido${duplicateCount===1?"":"s"} em ${source.name}`);
  toast(`Excedentes enviados para ${target.name}: ${parts.join(" • ")}.`,true);
}

function renderBusSelector(){
  const select=document.getElementById("busSelect");
  const nameEl=document.getElementById("activeBusName");
  if(!select) return;
  const buses=app.buses||[];
  select.innerHTML=buses.map((b,i)=>`<option value="${escapeHtml(b.id)}" ${b.id===app.activeBusId?'selected':''}>${escapeHtml(b.name||`Ônibus ${i+1}`)}</option>`).join("");
  const active=getActiveBus();
  if(nameEl) nameEl.textContent=active?.name||"Ônibus";
  updateOverflowTransferButton();
}

function renderDriverName(){
  const el=document.getElementById("driverNameDisplay");
  if(el) el.textContent=(app.config?.driverName||"Não informado").trim()||"Não informado";
}

function editActiveDriver(){
  const current=(app.config?.driverName||"Não informado").trim()||"Não informado";
  const raw=prompt("Nome do motorista deste ônibus:",current);
  if(raw===null) return;
  const name=raw.trim();
  if(!name){ toast("Informe o nome do motorista.",true); return; }
  pushUndo(`alteração do motorista para ${name}`);
  if(!app.config) app.config={destination:"Faculdade",shift:"Noite",driverName:name};
  app.config.driverName=name;
  syncActiveBusSnapshot();
  saveApp();
  renderDriverName();
  toast(`Motorista alterado para ${name}.`,true);
}

function refreshBusFormFields(){
  const dest=document.getElementById("destination");
  const shift=document.getElementById("shift");
  if(dest) dest.value=app.config?.destination||"Faculdade";
  if(shift) shift.value=app.config?.shift||"Noite";
  renderDriverName();
}

function switchBus(busId){
  if(!busId || busId===app.activeBusId) return;
  syncActiveBusSnapshot();
  const bus=app.buses.find(b=>b.id===busId);
  if(!bus) return;
  app.activeBusId=busId;
  loadBusIntoCurrent(bus);
  selectedPassengerIds.clear();
  undoStack.length=0;
  refreshBusFormFields();
  saveApp();
  renderAll();
  toast(`Agora você está gerenciando ${bus.name}.`,true);
}

function addBus(){
  syncActiveBusSnapshot();
  const nextNumber=(app.buses?.length||0)+1;
  const suggested=`Ônibus ${nextNumber}`;
  const raw=prompt("Nome do novo ônibus:",suggested);
  if(raw===null) return;
  const name=raw.trim()||suggested;
  const bus={
    id:cryptoId(), name,
    passengers:[], daily:{}, extraGroups:{}, waitingLists:{},
    config:{destination:app.config?.destination||"Faculdade",shift:app.config?.shift||"Noite",driverName:"Não informado"},
    seatConfig:{disabled:[],extraCount:0}
  };
  app.buses.push(bus);
  app.activeBusId=bus.id;
  loadBusIntoCurrent(bus);
  selectedPassengerIds.clear();
  undoStack.length=0;
  refreshBusFormFields();
  saveApp();
  renderAll();
  toast(`${name} adicionado. O mapa está vazio e pronto para uso.`,true);
}

function renameActiveBus(){
  const bus=getActiveBus();
  if(!bus) return;
  const raw=prompt("Novo nome do ônibus:",bus.name||"Ônibus");
  if(raw===null) return;
  const name=raw.trim();
  if(!name) return;
  bus.name=name;
  saveApp();
  renderBusSelector();
  toast(`Ônibus renomeado para ${name}.`,true);
}

function deleteActiveBus(){
  if((app.buses||[]).length<=1){
    toast("É necessário manter pelo menos um ônibus.",true);
    return;
  }
  const bus=getActiveBus();
  if(!bus) return;
  if(!confirm(`Excluir ${bus.name}? Os passageiros, fila e histórico deste ônibus serão apagados.`)) return;
  app.buses=app.buses.filter(b=>b.id!==bus.id);
  const next=app.buses[0];
  app.activeBusId=next.id;
  loadBusIntoCurrent(next);
  selectedPassengerIds.clear();
  undoStack.length=0;
  refreshBusFormFields();
  saveApp();
  renderAll();
  toast(`${bus.name} foi excluído.`,true);
}

migrateAppData();
ensureBusSystem();

function defaultApp(){
  return {
    passengers: [],
    daily: {},
    extraGroups: {},
    waitingLists: {},
    config: { destination:"Faculdade", shift:"Noite", driverName:"Bonfim" },
    seatConfig: { disabled:[], extraCount:0 },
    buses: [],
    activeBusId: null
  };
}

function loadApp(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? {...defaultApp(), ...JSON.parse(raw)} : defaultApp();
  }catch(e){ return defaultApp(); }
}

function saveApp(){
  syncActiveBusSnapshot();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app));
}

function todayISO(){
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

function currentDate(){
  return document.getElementById("tripDate").value || todayISO();
}

function getDay(){
  const date = currentDate();
  if(!app.daily[date]) app.daily[date] = {};
  return app.daily[date];
}

function getPassengerStatus(passengerId, direction){
  const day = getDay();
  if(!day[passengerId]) day[passengerId] = {ida:"pending", volta:"pending"};
  return day[passengerId][direction] || "pending";
}

function setPassengerStatus(passengerId, direction, status){
  const passenger=app.passengers.find(p=>p.id===passengerId);
  if(passenger && !isEligibleForDirection(passenger,direction)){
    toast(`${passenger.name} está marcado(a) como ${travelModeLabel(passengerTravelMode(passenger))}.`);
    return;
  }
  pushUndo(`alteração de status de ${passenger?.name||"passageiro"}`);
  const day = getDay();
  if(!day[passengerId]) day[passengerId] = {ida:"pending", volta:"pending"};
  day[passengerId][direction] = status;
  saveApp();
  renderAll();
}


function quickConfirmPassengerBySeat(seat){
  seat=Number(seat);
  const p=passengerBySeat(seat);
  if(!p){
    openSeatModal(seat);
    return;
  }

  const direction=document.getElementById("direction")?.value||"ida";

  if(!isEligibleForDirection(p,direction)){
    toast(`${p.name} está marcado(a) como ${travelModeLabel(passengerTravelMode(p))} e não utiliza a ${direction}.`);
    return;
  }

  const current=getPassengerStatus(p.id,direction);

  // Toque rápido funciona como alternador:
  // amarelo (aguardando) -> confirmado
  // confirmado -> amarelo (aguardando)
  if(current==="boarded"){
    setPassengerStatus(p.id,direction,"pending");
    toast(direction==="ida"
      ? `↶ Embarque de ${p.name} voltou para aguardando.`
      : `↶ Retorno de ${p.name} voltou para aguardando.`);
    return;
  }

  setPassengerStatus(p.id,direction,"boarded");
  toast(direction==="ida"
    ? `✓ Embarque de ${p.name} confirmado.`
    : `✓ Retorno de ${p.name} confirmado.`);
}

function statusLabel(status, direction){
  if(status==="boarded") return direction==="ida" ? "Embarcou" : "Retornou";
  if(status==="absent") return direction==="ida" ? "Não vai" : "Não volta";
  return "Aguardando";
}

function statusClass(status, direction){
  if(status==="boarded") return direction==="volta" ? "returned" : "boarded";
  if(status==="absent") return "absent";
  return "pending";
}

function chipClass(status, direction){
  if(status==="boarded") return direction==="volta" ? "chip-returned" : "chip-boarded";
  if(status==="absent") return "chip-absent";
  return "chip-pending";
}

function passengerBySeat(seat){
  return app.passengers.find(p => Number(p.seat) === Number(seat));
}

let draggedSeat = null;
let draggedWaitingId = null;
let isDraggingSeat = false;
let isDraggingWaiting = false;
let suppressSeatClickUntil = 0;
let touchDragTargetSeat = null;
let touchDragTargetWaitingId = null;
let mobileMoveSourceSeat = null;

function clearSeatDropHighlights(){
  document.querySelectorAll(".seat.drop-target,.seat.dragging,.seat.drop-invalid,.seat.drop-swap,.seat.drop-waiting").forEach(el=>{
    el.classList.remove("drop-target","drop-swap","dragging","drop-invalid","drop-waiting");
  });
  document.querySelectorAll(".waiting-item.waiting-dragging,.waiting-item.waiting-drop-target").forEach(el=>{
    el.classList.remove("waiting-dragging","waiting-drop-target");
  });
}

function movePassengerBetweenSeats(fromSeat,toSeat){
  fromSeat=Number(fromSeat);
  toSeat=Number(toSeat);
  if(!fromSeat || !toSeat || fromSeat===toSeat) return false;

  const source=passengerBySeat(fromSeat);
  if(!source) return false;
  const target=passengerBySeat(toSeat);
  pushUndo(target ? `troca de poltronas entre ${source.name} e ${target.name}` : `mudança de ${source.name} para a poltrona ${String(toSeat).padStart(2,"0")}`);

  if(target){
    source.seat=toSeat;
    target.seat=fromSeat;
    saveApp();
    renderAll();
    toast(`${source.name} e ${target.name} trocaram de poltrona.`);
  }else{
    source.seat=toSeat;
    saveApp();
    renderAll();
    toast(`${source.name} movido para a poltrona ${String(toSeat).padStart(2,"0")}.`);
  }
  return true;
}


function updateSeatMoveBar(){
  const bar=document.getElementById("seatMoveBar");
  if(!bar) return;
  const title=document.getElementById("seatMoveBarTitle");
  const hint=document.getElementById("seatMoveBarHint");

  if(mobileMoveSourceSeat===null){
    bar.hidden=true;
    document.body.classList.remove("seat-move-active");
    return;
  }

  const p=passengerBySeat(mobileMoveSourceSeat);
  if(!p){
    mobileMoveSourceSeat=null;
    bar.hidden=true;
    document.body.classList.remove("seat-move-active");
    return;
  }

  bar.hidden=false;
  document.body.classList.add("seat-move-active");
  if(title) title.textContent=`Mover ${p.name}`;
  if(hint) hint.textContent=`Poltrona ${String(mobileMoveSourceSeat).padStart(2,"0")} selecionada • toque no destino`;
}

function startSeatMove(seat){
  seat=Number(seat);
  const p=passengerBySeat(seat);
  if(!p) return;

  mobileMoveSourceSeat=seat;
  closeSeatModal();
  renderAll();
  updateSeatMoveBar();

  setTimeout(()=>{
    const bus=document.querySelector(".bus-wrap");
    if(bus) bus.scrollIntoView({behavior:"smooth",block:"center"});
  },40);

  toast(`${p.name} selecionado. Agora toque na poltrona de destino.`);
}

function cancelSeatMove(){
  mobileMoveSourceSeat=null;
  clearSeatDropHighlights();
  updateSeatMoveBar();
  renderSeatMap();
}

function handleSeatMoveTap(targetSeat){
  if(mobileMoveSourceSeat===null) return false;

  const fromSeat=Number(mobileMoveSourceSeat);
  const toSeat=Number(targetSeat);

  if(fromSeat===toSeat){
    cancelSeatMove();
    return true;
  }

  const source=passengerBySeat(fromSeat);
  if(!source){
    cancelSeatMove();
    return true;
  }

  const target=passengerBySeat(toSeat);
  if(target){
    const ok=confirm(`A poltrona ${String(toSeat).padStart(2,"0")} está ocupada por ${target.name}.\n\nDeseja trocar ${source.name} e ${target.name} de poltrona?`);
    if(!ok) return true;
  }

  mobileMoveSourceSeat=null;
  updateSeatMoveBar();
  movePassengerBetweenSeats(fromSeat,toSeat);
  return true;
}

function renderSeatMap(){
  const holder = document.getElementById("seatMap");
  const direction = document.getElementById("direction").value;
  const frontSeatHolder = document.getElementById("frontSeat49");
  holder.innerHTML = "";
  frontSeatHolder.innerHTML = "";
  frontSeatHolder.appendChild(makeSeat(49,direction));

  // Mapeamento original: janela ímpar, corredor par; no lado direito
  // o corredor aparece antes da janela (04/03, 08/07, ...).
  for(let row=0; row<12; row++){
    const start = row*4+1;
    const div = document.createElement("div");
    div.className = "seat-row";
    div.appendChild(makeSeat(start,direction));
    div.appendChild(makeSeat(start+1,direction));
    const aisle = document.createElement("div");
    aisle.className = "aisle";
    aisle.textContent = "CORREDOR";
    div.appendChild(aisle);
    div.appendChild(makeSeat(start+3,direction));
    div.appendChild(makeSeat(start+2,direction));
    holder.appendChild(div);
  }

  const cfg=normalizeSeatConfig(app.seatConfig);
  if(cfg.extraCount>0){
    const block=document.createElement("div");
    block.className="extra-seats-block";
    block.innerHTML=`<div class="extra-seats-title"><strong>Poltronas adicionais</strong><span>${cfg.extraCount} lugar${cfg.extraCount===1?'':'es'}</span></div>`;
    const grid=document.createElement("div");
    grid.className="extra-seats-grid";
    for(let n=50;n<=49+cfg.extraCount;n++) grid.appendChild(makeSeat(n,direction));
    block.appendChild(grid);
    holder.appendChild(block);
  }
}

function seatPositionLabel(n){
  if(Number(n)>49) return "EXTRA";
  if(Number(n)===49) return "FRENTE";
  const mod=(Number(n)-1)%4;
  return (mod===0 || mod===2) ? "JANELA" : "CORREDOR";
}

function makeSeat(n,direction){
  const p = passengerBySeat(n);
  const b = document.createElement("button");
  b.className = "seat";
  b.dataset.seat = n;
  b.type = "button";
  const pos=seatPositionLabel(n);
  if(!isSeatActive(n)){
    b.classList.add("seat-disabled");
    b.setAttribute("aria-disabled","true");
    b.title="Poltrona desabilitada neste ônibus";
    b.innerHTML=`<span class="seat-pos">${pos}</span><span class="num">${String(n).padStart(2,"0")}</span><span class="name">Desabilitada</span>`;
    return b;
  }
  if(!p){
    b.classList.add("free");
    b.innerHTML = `<span class="seat-pos">${pos}</span><span class="num">${String(n).padStart(2,"0")}</span><span class="name">Livre</span>`;
  }else{
    const st = getPassengerStatus(p.id,direction);
    const mode = passengerTravelMode(p);
    b.classList.add(statusClass(st,direction), travelModeClass(mode));
    b.draggable = true;
    b.title = `Clique para confirmar ${p.name}. Pressione e segure para abrir as opções.`;
    b.setAttribute("aria-label", `${p.name}, poltrona ${n}. Toque para confirmar. Pressione e segure para abrir opções.`);
    if(st==="boarded") b.classList.add("seat-confirmed");
    b.innerHTML = `<span class="seat-pos">${pos}</span><span class="num">${String(n).padStart(2,"0")}</span><span class="name">${escapeHtml(p.name)}</span>${st==="boarded"?'<span class="seat-confirm-mark" aria-hidden="true">✓</span>':''}<span class="drag-handle" aria-hidden="true">⋮⋮</span>`;

    b.addEventListener("dragstart", e=>{
      draggedSeat=n;
      isDraggingSeat=true;
      b.classList.add("dragging");
      if(e.dataTransfer){
        e.dataTransfer.effectAllowed="move";
        e.dataTransfer.setData("text/plain",String(n));
      }
    });

    b.addEventListener("dragend", ()=>{
      clearSeatDropHighlights();
      draggedSeat=null;
      setTimeout(()=>{ isDraggingSeat=false; },80);
    });

    // Celular/tablet:
    // toque rápido = confirmar presença;
    // toque prolongado = abrir as opções completas da poltrona.
    let longPressTimer=null;
    let longPressTriggered=false;
    let touchStartX=0;
    let touchStartY=0;

    b.addEventListener("touchstart", e=>{
      if(mobileMoveSourceSeat!==null) return;
      const touch=e.touches?.[0];
      if(touch){
        touchStartX=touch.clientX;
        touchStartY=touch.clientY;
      }
      longPressTriggered=false;
      clearTimeout(longPressTimer);
      longPressTimer=setTimeout(()=>{
        longPressTriggered=true;
        suppressSeatClickUntil=Date.now()+700;
        if(navigator.vibrate) navigator.vibrate(25);
        openSeatModal(n);
      },560);
    },{passive:true});

    b.addEventListener("touchmove", e=>{
      const touch=e.touches?.[0];
      if(!touch) return;
      const moved=Math.hypot(touch.clientX-touchStartX,touch.clientY-touchStartY);
      if(moved>12) clearTimeout(longPressTimer);
    },{passive:true});

    b.addEventListener("touchend", ()=>{
      clearTimeout(longPressTimer);
      if(longPressTriggered){
        suppressSeatClickUntil=Date.now()+700;
        longPressTriggered=false;
      }
    },{passive:true});

    b.addEventListener("touchcancel", ()=>{
      clearTimeout(longPressTimer);
      longPressTriggered=false;
    },{passive:true});

    b.addEventListener("contextmenu", e=>e.preventDefault());
  }

  if(mobileMoveSourceSeat!==null){
    if(Number(n)===Number(mobileMoveSourceSeat)){
      b.classList.add("move-source");
    }else{
      b.classList.add("move-target");
      if(passengerBySeat(n)) b.classList.add("move-target-occupied");
    }
  }

  b.addEventListener("dragover", e=>{
    if(draggedWaitingId!==null){
      e.preventDefault();
      if(e.dataTransfer) e.dataTransfer.dropEffect = passengerBySeat(n) ? "none" : "move";
      b.classList.add(passengerBySeat(n) ? "drop-invalid" : "drop-target");
      if(!passengerBySeat(n)) b.classList.add("drop-waiting");
      return;
    }
    if(draggedSeat===null || Number(draggedSeat)===Number(n)) return;
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect="move";
    b.classList.add("drop-target");
    if(passengerBySeat(n)) b.classList.add("drop-swap");
  });

  b.addEventListener("dragleave", ()=>{
    b.classList.remove("drop-target","drop-swap","drop-invalid","drop-waiting");
  });

  b.addEventListener("drop", e=>{
    e.preventDefault();
    e.stopPropagation();

    if(draggedWaitingId!==null){
      const waitingId = draggedWaitingId || (e.dataTransfer ? e.dataTransfer.getData("application/x-mapabus-waiting") : "");
      clearSeatDropHighlights();
      draggedWaitingId = null;
      isDraggingWaiting = false;
      suppressSeatClickUntil=Date.now()+300;
      if(passengerBySeat(n)){
        toast("Para arrastar alguém da fila, solte em uma poltrona livre.");
        return;
      }
      if(waitingId) allocateWaitingPassengerToSeat(waitingId, n);
      return;
    }

    const sourceSeat=Number(draggedSeat || (e.dataTransfer ? e.dataTransfer.getData("text/plain") : 0));
    clearSeatDropHighlights();
    draggedSeat=null;
    suppressSeatClickUntil=Date.now()+300;
    if(sourceSeat && sourceSeat!==Number(n)) movePassengerBetweenSeats(sourceSeat,n);
  });

  b.onclick = () => {
    if(isDraggingSeat || isDraggingWaiting || Date.now()<suppressSeatClickUntil) return;
    if(handleSeatMoveTap(n)) return;

    const passenger=passengerBySeat(n);

    // Celular/tablet: toque rápido confirma imediatamente.
    const isDesktopPointer = window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    if(!isDesktopPointer){
      if(passenger) quickConfirmPassengerBySeat(n);
      else openSeatModal(n);
      return;
    }

    // Desktop: aguarda alguns milissegundos para diferenciar
    // 1 clique de 2 cliques.
    clearTimeout(b._singleClickTimer);
    b._singleClickTimer=setTimeout(()=>{
      if(passenger) quickConfirmPassengerBySeat(n);
      else openSeatModal(n);
      b._singleClickTimer=null;
    },240);
  };

  // Desktop: dois cliques abrem o menu antigo sem alterar a confirmação.
  b.ondblclick = (e) => {
    const isDesktopPointer = window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if(!isDesktopPointer) return;
    if(isDraggingSeat || isDraggingWaiting || Date.now()<suppressSeatClickUntil) return;

    e.preventDefault();
    e.stopPropagation();
    clearTimeout(b._singleClickTimer);
    b._singleClickTimer=null;
    openSeatModal(n);
  };
  return b;
}

function renderStats(){
  const direction = document.getElementById("direction").value;
  const total = app.passengers.length;
  let boarded=0,pending=0,absent=0;
  app.passengers.forEach(p=>{
    const st=getPassengerStatus(p.id,direction);
    if(st==="boarded") boarded++;
    else if(st==="absent") absent++;
    else pending++;
  });
  document.getElementById("statRegistered").textContent=total;
  document.getElementById("statBoarded").textContent=boarded;
  document.getElementById("statPending").textContent=pending;
  document.getElementById("statAbsent").textContent=absent;
}

function renderPendingList(){
  const holder=document.getElementById("pendingList");
  const direction=document.getElementById("direction").value;
  const list=app.passengers
    .filter(p=>getPassengerStatus(p.id,direction)==="pending")
    .sort((a,b)=>Number(a.seat)-Number(b.seat));

  if(!list.length){
    holder.innerHTML=`<div class="empty">Ninguém aguardando embarque.</div>`;
    return;
  }
  holder.innerHTML=list.map(p=>`
    <div class="passenger-item">
      <div class="seat-badge">${String(p.seat).padStart(2,"0")}</div>
      <div>
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="sub">${escapeHtml(p.pickup || "Ponto não informado")}</div>
      </div>
      <button class="mini-btn mini-primary" onclick="setPassengerStatus('${p.id}','${direction}','boarded')">
        Confirmar
      </button>
    </div>`).join("");
}


function normalizeGroupForPriority(name){
  return String(name||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[º°⁰]/g, "")
    .toLowerCase()
    .trim();
}

function getGroupPriority(groupName){
  const s=normalizeGroupForPriority(groupName);
  const has4=/(^|\D)4(\D|$)/.test(s) || s.includes("quarto semestre");
  const has3=/(^|\D)3(\D|$)/.test(s) || s.includes("terceiro semestre");
  const has2=/(^|\D)2(\D|$)/.test(s) || s.includes("segundo semestre");
  const has1=/(^|\D)1(\D|$)/.test(s) || s.includes("primeiro semestre");
  if(has4 && has3) return 3.5;
  if(has4) return 4;
  if(has3) return 3;
  if(has2) return 2;
  if(has1) return 1;
  if(s.includes("facibi")) return 0.75;
  if(s.includes("uniplan")) return 0.5;
  const nums=(s.match(/\d+/g)||[]).map(Number).filter(n=>n>=1 && n<=20);
  if(nums.length) return Math.max(...nums);
  return 0;
}

function priorityTier(priority){
  if(Number(priority)>=3.5) return 4;
  if(Number(priority)>=3) return 3;
  if(Number(priority)>=2) return 2;
  if(Number(priority)>=1) return 1;
  return 1;
}

function priorityLabel(priority, groupName){
  priority=Number(priority)||0;
  if(priority===4) return "4º semestre";
  if(priority===3.5) return "4º/3º agrupados";
  if(priority===3) return "3º semestre";
  if(priority===2) return "2º semestre";
  if(priority===1) return "1º semestre";
  if(/facibi/i.test(groupName||"")) return "FACIBI";
  if(/uniplan/i.test(groupName||"")) return "Uniplan";
  return "Semestre não informado";
}

function sortWaitingList(list){
  const hasManual=(list||[]).some(p=>Number.isFinite(Number(p.manualOrder)));
  return (list||[]).slice().sort((a,b)=>{
    if(hasManual){
      const am=Number.isFinite(Number(a.manualOrder)) ? Number(a.manualOrder) : Number.MAX_SAFE_INTEGER;
      const bm=Number.isFinite(Number(b.manualOrder)) ? Number(b.manualOrder) : Number.MAX_SAFE_INTEGER;
      if(am!==bm) return am-bm;
    }
    if(Number(b.priority)!==Number(a.priority)) return Number(b.priority)-Number(a.priority);
    if(Number(a.groupIndex)!==Number(b.groupIndex)) return Number(a.groupIndex)-Number(b.groupIndex);
    return Number(a.order)-Number(b.order);
  });
}

function waitingManualOrderActive(list=getWaitingList()){
  return (list||[]).some(p=>Number.isFinite(Number(p.manualOrder)));
}

function reorderWaitingPassenger(draggedId,targetId){
  if(!draggedId || !targetId || draggedId===targetId) return;
  const date=currentDate();
  const ordered=sortWaitingList(getWaitingList(date));
  const from=ordered.findIndex(p=>p.id===draggedId);
  const to=ordered.findIndex(p=>p.id===targetId);
  if(from<0 || to<0) return;
  pushUndo("reordenação manual da fila de espera");
  const [moved]=ordered.splice(from,1);
  const insertAt=ordered.findIndex(p=>p.id===targetId);
  ordered.splice(insertAt<0?ordered.length:insertAt,0,moved);
  ordered.forEach((p,i)=>p.manualOrder=i+1);
  app.waitingLists[date]=ordered;
  saveApp();
  renderAll();
  toast(`${moved.name} foi reposicionado(a) na fila.`);
}

function restoreAutomaticWaitingPriority(){
  const date=currentDate();
  const list=getWaitingList(date);
  if(!waitingManualOrderActive(list)){ toast("A fila já está usando a prioridade automática."); return; }
  pushUndo("restauração da prioridade automática da fila");
  list.forEach(p=>delete p.manualOrder);
  app.waitingLists[date]=sortWaitingList(list);
  saveApp();
  renderAll();
  toast("Prioridade automática restaurada.");
}

function getWaitingList(date=currentDate()){
  if(!app.waitingLists) app.waitingLists={};
  return app.waitingLists[date] || [];
}

function freeSeatNumbers(){
  const occupied=new Set(app.passengers.map(p=>Number(p.seat)));
  return configuredSeatNumbers().filter(n=>!occupied.has(n));
}

function renderWaitingList(){
  const holder=document.getElementById("waitingList");
  const summary=document.getElementById("waitingSummary");
  const freeBadge=document.getElementById("waitingFreeSeats");
  const nextCall=document.getElementById("waitingNextCall");
  const groupFilter=document.getElementById("waitingGroupFilter");
  const statusFilter=document.getElementById("waitingStatusFilter");
  const searchInput=document.getElementById("waitingSearch");
  if(!holder || !summary || !freeBadge) return;

  const list=sortWaitingList(getWaitingList());
  updateOverflowTransferButton();
  const freeSeats=freeSeatNumbers();
  const activeDirection=document.getElementById("direction")?.value||"ida";
  const eligibleList=list.filter(p=>isEligibleForDirection(p,activeDirection));
  const availableNow=Math.min(eligibleList.length,freeSeats.length);
  const remaining=Math.max(0,list.length-availableNow);
  const manualActive=waitingManualOrderActive(list);
  const restoreBtn=document.getElementById("restorePriorityBtn");
  if(restoreBtn) restoreBtn.style.display=manualActive?"inline-flex":"none";

  freeBadge.textContent=`${freeSeats.length} vaga${freeSeats.length===1?"":"s"} livre${freeSeats.length===1?"":"s"}`;

  const rawGroups=[];
  const rawGroupMap=new Map();
  list.forEach((p,index)=>{
    const key=p.group||"Sem grupo";
    if(!rawGroupMap.has(key)){
      const group={name:key,priority:Number(p.priority)||0,people:[]};
      rawGroupMap.set(key,group);
      rawGroups.push(group);
    }
    rawGroupMap.get(key).people.push({...p,globalPosition:index+1});
  });

  if(groupFilter){
    const current=groupFilter.value || "all";
    groupFilter.innerHTML=['<option value="all">Todos os grupos</option>']
      .concat(rawGroups.map(g=>`<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${g.people.length})</option>`))
      .join('');
    if([...groupFilter.options].some(o=>o.value===current)) groupFilter.value=current;
  }

  const nextSeat=freeSeats.length?String(freeSeats[0]).padStart(2,"0"):"—";
  summary.innerHTML=`
    <div class="waiting-overview">
      <div class="waiting-overview-card overview-total"><span class="overview-label">Na fila</span><strong>${list.length}</strong><small>alunos</small></div>
      <div class="waiting-overview-card overview-free"><span class="overview-label">Vagas livres</span><strong>${freeSeats.length}</strong><small>próxima: ${nextSeat}</small></div>
      <div class="waiting-overview-card overview-next"><span class="overview-label">Entram agora</span><strong>${availableNow}</strong><small>pela prioridade</small></div>
      <div class="waiting-overview-card overview-remain"><span class="overview-label">Aguardando</span><strong>${remaining}</strong><small>na fila</small></div>
    </div>
    ${rawGroups.length?`<div class="waiting-order-guide"><div class="waiting-order-title">Ordem de prioridade</div><div class="waiting-order-flow">${rawGroups.map((g,i)=>`<span class="waiting-order-step"><b>${i+1}º</b> ${escapeHtml(g.name)}</span>`).join('<span class="waiting-order-arrow">→</span>')}</div></div>`:''}
    ${manualActive?'<div class="manual-order-banner"><strong>Ordem manual ativa</strong><span>Use “Restaurar prioridade” para voltar ao automático.</span></div>':''}`;

  if(!list.length){
    if(nextCall) nextCall.innerHTML='';
    holder.innerHTML=`<div class="empty">Nenhum aluno na fila de espera.</div>`;
    return;
  }

  if(nextCall){
    const nextPeople=eligibleList.slice(0,Math.min(freeSeats.length?4:3,eligibleList.length));
    nextCall.innerHTML=nextPeople.length?`
      <div class="next-call-head">
        <div><strong>${freeSeats.length?'Próximos a entrar':'Próximos da fila'}</strong><span>${freeSeats.length?`${availableNow} podem entrar agora`:'Sem vagas disponíveis'}</span></div>
        ${freeSeats.length?`<div class="next-seat-pill">Próxima vaga ${nextSeat}</div>`:''}
      </div>
      <div class="next-call-people">
        ${nextPeople.map((p,i)=>`<div class="next-person ${i<freeSeats.length?'next-person-ready':''}"><span class="next-number">${i+1}</span><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.group||'Sem grupo')}</small></div><em>${i<freeSeats.length?'entra agora':'na sequência'}</em></div>`).join('')}
      </div>`:'';
  }

  const query=(searchInput?.value||'').trim().toLowerCase();
  const selectedGroup=groupFilter?.value||'all';
  const selectedStatus=statusFilter?.value||'all';

  const filtered=list.filter(p=>{
    const eligiblePosition=eligibleList.findIndex(x=>x.id===p.id)+1;
    const getsSeat=eligiblePosition>0 && eligiblePosition<=freeSeats.length;
    const mode=waitingTravelMode(p);
    if(query && !`${p.name} ${p.group||''}`.toLowerCase().includes(query)) return false;
    if(selectedGroup!=='all' && (p.group||'Sem grupo')!==selectedGroup) return false;
    if(selectedStatus==='now' && !getsSeat) return false;
    if(selectedStatus==='waiting' && getsSeat) return false;
    if(selectedStatus==='return' && mode!=="volta") return false;
    if(selectedStatus==='idaonly' && mode!=="ida") return false;
    if(selectedStatus==='both' && mode!=="ambos") return false;
    return true;
  });

  if(!filtered.length){
    holder.innerHTML=`<div class="empty">Nenhum aluno corresponde aos filtros.</div>`;
    return;
  }

  const groups=[];
  const groupMap=new Map();
  filtered.forEach(p=>{
    const originalIndex=list.findIndex(x=>x.id===p.id);
    const key=manualActive?"Ordem manual":(p.group||"Sem grupo");
    if(!groupMap.has(key)){
      const group={name:key,priority:manualActive?0:(Number(p.priority)||0),people:[]};
      groupMap.set(key,group);
      groups.push(group);
    }
    groupMap.get(key).people.push({...p,globalPosition:originalIndex+1});
  });

  holder.innerHTML=groups.map((group,groupIndex)=>{
    const priorityIndex=rawGroups.findIndex(g=>g.name===group.name)+1;
    return `
      <details class="waiting-group-card priority-card-${manualActive?1:priorityTier(group.priority)}" ${groupIndex===0?'open':''}>
        <summary class="waiting-group-head">
          <div class="waiting-group-rank">${manualActive?'MANUAL':`${priorityIndex}ª prioridade`}</div>
          <div class="waiting-group-heading"><strong>${escapeHtml(group.name)}</strong><span>${group.people.length} aluno${group.people.length===1?'':'s'}</span></div>
          <div class="waiting-group-priority priority-${manualActive?1:priorityTier(group.priority)}">${manualActive?'Ordem manual':priorityLabel(group.priority,group.name)}</div>
          <span class="group-chevron">⌄</span>
        </summary>
        <div class="waiting-group-people">
          ${group.people.map((p,localIndex)=>{
            const eligiblePosition=eligibleList.findIndex(x=>x.id===p.id)+1;
            const getsSeat=eligiblePosition>0 && eligiblePosition<=freeSeats.length;
            const mode=waitingTravelMode(p);
            const suggestedSeat=getsSeat?String(freeSeats[eligiblePosition-1]).padStart(2,"0"):"";
            const needVacancies=eligiblePosition>0?Math.max(0,eligiblePosition-freeSeats.length):0;
            const statusHtml=!isEligibleForDirection(p,activeDirection)
              ? `<strong>Não usa ${activeDirection}</strong><span>${travelModeLabel(mode)}</span>`
              : getsSeat
                ? `<strong>Entra agora</strong><span>Poltrona ${suggestedSeat}</span>`
                : `<strong>Aguardando</strong><span>${needVacancies?`Faltam ${needVacancies} vaga${needVacancies===1?'':'s'}`:'Próximo da fila'}</span>`;
            return `
              <div class="waiting-item ${getsSeat?'waiting-will-enter':''} ${mode==='volta'?'waiting-only-return':''}" data-waiting-id="${p.id}" draggable="true">
                <div class="waiting-position-wrap"><div class="waiting-position">${p.globalPosition}</div><span>fila</span></div>
                <div class="waiting-person">
                  <div class="waiting-name-row"><div class="waiting-name">${escapeHtml(p.name)}</div><span class="travel-mode-chip ${travelModeClass(mode)}">${travelModeLabel(mode)}</span><span class="waiting-drag-handle" aria-hidden="true">⋮⋮</span></div>
                  <div class="waiting-group">${manualActive?escapeHtml(p.group||'Sem grupo'):`${localIndex+1}º deste grupo`}</div>
                </div>
                <div class="waiting-seat-status ${getsSeat?'seat-status-now':'seat-status-wait'}">${statusHtml}</div>
                <div class="waiting-row-actions">
                  <select class="quick-travel-select waiting-travel-select ${travelModeClass(mode)}" onchange="setWaitingTravelModeManual('${p.id}',this.value)" onclick="event.stopPropagation()">
                    <option value="ambos" ${mode==='ambos'?'selected':''}>Ida + volta</option>
                    <option value="ida" ${mode==='ida'?'selected':''}>Só ida</option>
                    <option value="volta" ${mode==='volta'?'selected':''}>Só volta</option>
                  </select>
                  <button class="mini-btn mini-primary" ${freeSeats.length?'':'disabled'} onclick="allocateWaitingPassenger('${p.id}')">Alocar</button>
                  <button class="mini-btn mini-danger" onclick="removeWaitingPassenger('${p.id}')">Remover</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </details>`;
  }).join('');

  bindWaitingDragAndDrop();
}

function bindWaitingDragAndDrop(){
  document.querySelectorAll(".waiting-item[data-waiting-id]").forEach(item=>{
    const waitingId=item.dataset.waitingId;
    if(!waitingId) return;
    item.draggable=true;

    item.addEventListener("dragstart", e=>{
      draggedWaitingId=waitingId;
      isDraggingWaiting=true;
      item.classList.add("waiting-dragging");
      if(e.dataTransfer){
        e.dataTransfer.effectAllowed="move";
        e.dataTransfer.setData("application/x-mapabus-waiting", waitingId);
        e.dataTransfer.setData("text/plain", waitingId);
      }
    });

    item.addEventListener("dragover", e=>{
      if(!draggedWaitingId || draggedWaitingId===waitingId) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.add("waiting-drop-target");
      if(e.dataTransfer) e.dataTransfer.dropEffect="move";
    });

    item.addEventListener("dragleave", ()=>item.classList.remove("waiting-drop-target"));

    item.addEventListener("drop", e=>{
      if(!draggedWaitingId || draggedWaitingId===waitingId) return;
      e.preventDefault();
      e.stopPropagation();
      const sourceId=draggedWaitingId;
      clearSeatDropHighlights();
      draggedWaitingId=null;
      isDraggingWaiting=false;
      reorderWaitingPassenger(sourceId,waitingId);
    });

    item.addEventListener("dragend", ()=>{
      clearSeatDropHighlights();
      draggedWaitingId=null;
      setTimeout(()=>{ isDraggingWaiting=false; },80);
    });

    let longPressTimer=null;
    let touchDragging=false;
    item.addEventListener("touchstart", ()=>{
      longPressTimer=setTimeout(()=>{
        draggedWaitingId=waitingId;
        touchDragging=true;
        isDraggingWaiting=true;
        item.classList.add("waiting-dragging");
        if(navigator.vibrate) navigator.vibrate(25);
      },320);
    },{passive:true});

    item.addEventListener("touchmove", e=>{
      if(!touchDragging){
        clearTimeout(longPressTimer);
        return;
      }
      e.preventDefault();
      const touch=e.touches[0];
      const element=document.elementFromPoint(touch.clientX,touch.clientY);
      const seatTarget=element?.closest(".seat");
      const waitingTarget=element?.closest(".waiting-item[data-waiting-id]");
      document.querySelectorAll(".seat.drop-target,.seat.drop-swap,.seat.drop-invalid,.seat.drop-waiting").forEach(el=>el.classList.remove("drop-target","drop-swap","drop-invalid","drop-waiting"));
      document.querySelectorAll(".waiting-item.waiting-drop-target").forEach(el=>el.classList.remove("waiting-drop-target"));
      touchDragTargetSeat=null;
      touchDragTargetWaitingId=null;
      if(seatTarget){
        touchDragTargetSeat=Number(seatTarget.dataset.seat);
        if(passengerBySeat(touchDragTargetSeat)) seatTarget.classList.add("drop-invalid");
        else seatTarget.classList.add("drop-target","drop-waiting");
      }else if(waitingTarget && waitingTarget.dataset.waitingId!==waitingId){
        touchDragTargetWaitingId=waitingTarget.dataset.waitingId;
        waitingTarget.classList.add("waiting-drop-target");
      }
    },{passive:false});

    const finishTouchDrag=()=>{
      clearTimeout(longPressTimer);
      if(touchDragging){
        const targetSeat=touchDragTargetSeat;
        const targetWaitingId=touchDragTargetWaitingId;
        clearSeatDropHighlights();
        touchDragging=false;
        draggedWaitingId=null;
        touchDragTargetSeat=null;
        touchDragTargetWaitingId=null;
        suppressSeatClickUntil=Date.now()+550;
        isDraggingWaiting=false;
        if(targetSeat){
          if(passengerBySeat(targetSeat)) toast("Para arrastar alguém da fila, solte em uma poltrona livre.");
          else allocateWaitingPassengerToSeat(waitingId,targetSeat);
        }else if(targetWaitingId){
          reorderWaitingPassenger(waitingId,targetWaitingId);
        }
      }
    };
    item.addEventListener("touchend",finishTouchDrag,{passive:true});
    item.addEventListener("touchcancel",finishTouchDrag,{passive:true});
  });
}

function allocateNextWaitingPassenger(){
  const direction=document.getElementById("direction")?.value||"ida";
  const list=sortWaitingList(getWaitingList()).filter(p=>isEligibleForDirection(p,direction));
  if(!list.length){ toast(`Não há alunos na fila que utilizem a ${direction}.`); return; }
  const freeSeats=freeSeatNumbers();
  if(!freeSeats.length){ toast("Não há poltronas livres no momento."); return; }
  allocateWaitingPassenger(list[0].id);
}

function removeWaitingPassenger(waitingId){
  const date=currentDate();
  const list=getWaitingList(date);
  const person=list.find(p=>p.id===waitingId);
  if(!person) return;
  pushUndo(`remoção de ${person.name} da fila`);
  app.waitingLists[date]=list.filter(p=>p.id!==waitingId);
  saveApp();
  renderAll();
  toast(`${person.name} foi removido(a) da espera.`);
}

function buildWaitingListFromGroups(groups,date){
  if(!app.waitingLists) app.waitingLists={};
  const seatedNames=new Set(app.passengers.map(p=>normalizeName(p.name)));
  const previous=new Map((app.waitingLists[date]||[]).map(p=>[normalizeName(p.name),p]));
  const waiting=[];
  groups.forEach((g,groupIndex)=>{
    const priority=getGroupPriority(g.name);
    g.people.forEach((person,personIndex)=>{
      if(seatedNames.has(normalizeName(person.name))) return;
      const old=previous.get(normalizeName(person.name));
      waiting.push({
        id:old?.id || cryptoId(),
        name:person.name,
        group:g.name,
        priority,
        groupIndex,
        order:Number(person.order)||personIndex+1,
        returnOnly:!!person.returnOnly,
        travelMode:normalizeTravelMode(person.travelMode,"",!!person.returnOnly),
        manualOrder:old?.manualOrder,
        line:person.line||null
      });
    });
  });
  app.waitingLists[date]=sortWaitingList(waiting);
}

function allocateWaitingPassengerToSeat(waitingId, seat, options={}){
  const date=currentDate();
  const list=getWaitingList(date);
  const person=list.find(p=>p.id===waitingId);
  seat=Number(seat);
  if(!person){ toast("Pessoa não encontrada na lista de espera."); return false; }
  if(!seat || !isSeatActive(seat)){ toast("Esta poltrona não está ativa neste ônibus."); return false; }
  if(passengerBySeat(seat)){ toast(`A poltrona ${String(seat).padStart(2,"0")} já está ocupada.`); return false; }
  if(!options.skipUndo) pushUndo(`alocação de ${person.name} na poltrona ${String(seat).padStart(2,"0")}`);

  const mode=waitingTravelMode(person);
  const passenger={
    id:cryptoId(), name:person.name, seat,
    phone:person.phone||"", course:person.group||"", pickup:person.pickup||"",
    notes:person.notes || (mode==="volta"?"Somente volta":mode==="ida"?"Somente ida":""),
    travelMode:mode
  };
  app.passengers.push(passenger);
  applyTravelModeStatus(passenger.id,date,mode,true);
  app.waitingLists[date]=list.filter(p=>p.id!==waitingId);
  saveApp();
  renderAll();
  toast(`${person.name} foi alocado(a) na poltrona ${String(seat).padStart(2,"0")}.`);
  return true;
}

function allocateWaitingPassenger(waitingId){
  const free=freeSeatNumbers();
  if(!free.length){ toast("Não há poltronas livres."); return; }
  allocateWaitingPassengerToSeat(waitingId, free[0]);
}

function fillFreeSeatsFromWaiting(){
  const date=currentDate();
  const direction=document.getElementById("direction")?.value||"ida";
  const list=sortWaitingList(getWaitingList(date)).filter(p=>isEligibleForDirection(p,direction));
  const free=freeSeatNumbers();
  if(!list.length){ toast(`Não há alunos na fila que utilizem a ${direction}.`); return; }
  if(!free.length){ toast("Não há poltronas livres."); return; }
  const qty=Math.min(list.length,free.length);
  if(!confirm(`Preencher ${qty} vaga(s) livre(s) seguindo a prioridade atual da fila para a ${direction}?`)) return;
  pushUndo(`preenchimento automático de ${qty} vaga(s)`);
  const allocatedIds=new Set();
  for(let i=0;i<qty;i++){
    const person=list[i];
    const mode=waitingTravelMode(person);
    const passenger={
      id:cryptoId(), name:person.name, seat:free[i],
      phone:person.phone||"", course:person.group||"", pickup:person.pickup||"",
      notes:person.notes || (mode==="volta"?"Somente volta":mode==="ida"?"Somente ida":""),
      travelMode:mode
    };
    app.passengers.push(passenger);
    applyTravelModeStatus(passenger.id,date,mode,true);
    allocatedIds.add(person.id);
  }
  app.waitingLists[date]=getWaitingList(date).filter(p=>!allocatedIds.has(p.id));
  saveApp();
  renderAll();
  toast(`${qty} aluno(s) foram alocados por prioridade.`);
}

const selectedPassengerIds = new Set();

function visiblePassengerRows(){
  const q=(document.getElementById("searchInput")?.value||"").toLowerCase().trim();
  return app.passengers
    .slice()
    .sort((a,b)=>Number(a.seat)-Number(b.seat))
    .filter(p=>{
      const text=[p.name,p.course,p.pickup,p.phone,p.seat].join(" ").toLowerCase();
      return !q || text.includes(q);
    });
}

function togglePassengerSelection(id,checked){
  if(checked) selectedPassengerIds.add(id);
  else selectedPassengerIds.delete(id);
  updatePassengerSelectionUI();
}

function toggleSelectAllVisible(checked){
  visiblePassengerRows().forEach(p=>{
    if(checked) selectedPassengerIds.add(p.id);
    else selectedPassengerIds.delete(p.id);
  });
  renderTable();
}

function clearPassengerSelection(){
  selectedPassengerIds.clear();
  renderTable();
}

function updatePassengerSelectionUI(){
  const btn=document.getElementById("deleteSelectedBtn");
  const master=document.getElementById("selectAllPassengers");
  const count=selectedPassengerIds.size;
  if(btn){
    btn.textContent=`Excluir selecionados (${count})`;
    btn.disabled=count===0;
  }
  if(master){
    const visible=visiblePassengerRows();
    const selectedVisible=visible.filter(p=>selectedPassengerIds.has(p.id)).length;
    master.checked=visible.length>0 && selectedVisible===visible.length;
    master.indeterminate=selectedVisible>0 && selectedVisible<visible.length;
  }
}

function deleteSelectedPassengers(){
  const ids=[...selectedPassengerIds].filter(id=>app.passengers.some(p=>p.id===id));
  if(!ids.length){ toast("Selecione pelo menos um aluno."); return; }
  const names=app.passengers.filter(p=>ids.includes(p.id)).map(p=>p.name);
  const preview=names.slice(0,4).join(", ")+(names.length>4?` e mais ${names.length-4}`:"");
  if(!confirm(`Excluir ${ids.length} aluno(s) de uma vez?\n\n${preview}\n\nAs poltronas deles ficarão livres.`)) return;
  pushUndo(`exclusão de ${ids.length} aluno(s)`);
  const idSet=new Set(ids);
  app.passengers=app.passengers.filter(p=>!idSet.has(p.id));
  Object.values(app.daily).forEach(day=>ids.forEach(id=>{ if(day[id]) delete day[id]; }));
  selectedPassengerIds.clear();
  saveApp();
  renderAll();
  toast(`${ids.length} aluno(s) excluído(s).`);
}

function renderTable(){
  const holder=document.getElementById("passengerTable");
  const rows=visiblePassengerRows();

  if(!holder) return;

  if(!rows.length){
    holder.innerHTML=`<div class="empty passenger-empty">Nenhum passageiro encontrado.</div>`;
    updatePassengerSelectionUI();
    return;
  }

  const direction=document.getElementById("direction")?.value||"ida";
  const confirmedCount=rows.filter(p=>getPassengerStatus(p.id,direction)==="boarded").length;

  holder.innerHTML=`
    <div class="passenger-group-card">
      <div class="passenger-group-head">
        <div class="passenger-group-badge">NO ÔNIBUS</div>
        <div class="passenger-group-heading">
          <strong>Passageiros</strong>
          <span>${rows.length} aluno${rows.length===1?"":"s"} • ${confirmedCount} confirmado${confirmedCount===1?"":"s"} na ${direction}</span>
        </div>
        <div class="passenger-group-status">${direction==="ida"?"Ida":"Volta"}</div>
      </div>

      <div class="passenger-card-list">
        ${rows.map(p=>{
          const ida=getPassengerStatus(p.id,"ida");
          const volta=getPassengerStatus(p.id,"volta");
          const mode=passengerTravelMode(p);
          const onlyReturn=mode==="volta";
          const selected=selectedPassengerIds.has(p.id);

          const extraInfo=[p.course,p.pickup].filter(Boolean).join(" • ");

          return `
            <div class="passenger-priority-row ${selected?'row-selected':''} ${onlyReturn?'row-only-return':''}">
              <div class="passenger-select-seat">
                <input class="passenger-checkbox" type="checkbox"
                  ${selected?'checked':''}
                  onchange="togglePassengerSelection('${p.id}',this.checked)"
                  aria-label="Selecionar ${escapeHtml(p.name)}">
                <div class="passenger-seat-badge">${String(p.seat).padStart(2,"0")}</div>
                <span>POLTRONA</span>
              </div>

              <div class="passenger-card-person">
                <div class="passenger-card-name-row">
                  <strong class="passenger-card-name ${onlyReturn?'name-only-return':''}">${escapeHtml(p.name)}</strong>
                  <span class="travel-mode-chip ${travelModeClass(mode)}">${travelModeLabel(mode)}</span>
                </div>
                ${extraInfo?`<div class="passenger-card-extra">${escapeHtml(extraInfo)}</div>`:''}
              </div>

              <div class="passenger-trip-statuses">
                <div class="passenger-trip-status">
                  <span>IDA</span>
                  <strong class="${chipClass(ida,"ida")}">${statusLabel(ida,"ida")}</strong>
                </div>
                <div class="passenger-trip-status">
                  <span>VOLTA</span>
                  <strong class="${chipClass(volta,"volta")}">${statusLabel(volta,"volta")}</strong>
                </div>
              </div>

              <div class="passenger-card-actions">
                <select class="quick-travel-select ${travelModeClass(mode)}"
                  onchange="setPassengerTravelModeManual('${p.id}',this.value)"
                  aria-label="Uso da viagem de ${escapeHtml(p.name)}">
                  <option value="ambos" ${mode==='ambos'?'selected':''}>Ida + volta</option>
                  <option value="ida" ${mode==='ida'?'selected':''}>Só ida</option>
                  <option value="volta" ${mode==='volta'?'selected':''}>Só volta</option>
                </select>
                <button class="mini-btn mini-primary" onclick="editPassenger('${p.id}')">Editar</button>
                <button class="mini-btn mini-warning" onclick="movePassengerToWaiting('${p.id}')">Liberar</button>
                <button class="mini-btn mini-danger" onclick="deletePassenger('${p.id}')">Excluir</button>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  updatePassengerSelectionUI();
}
function renderAll(){
  renderBusSelector();
  renderDriverName();
  renderSeatMap();
  renderStats();
  renderPendingList();
  renderWaitingList();
  renderTable();
  fillSeatOptions();
  updateUndoUI();
  updateSeatMoveBar();
}

function fillSeatOptions(selected){
  const select=document.getElementById("seat");
  const editingId=document.getElementById("editingId").value;
  const occupied = new Set(app.passengers.filter(p=>p.id!==editingId).map(p=>Number(p.seat)));
  select.innerHTML="";
  configuredSeatNumbers().forEach(i=>{
    if(!occupied.has(i) || Number(selected)===i){
      const o=document.createElement("option");
      o.value=i;
      o.textContent=`Poltrona ${String(i).padStart(2,"0")}${i>49?" (extra)":""}${occupied.has(i) ? " (ocupada)" : ""}`;
      select.appendChild(o);
    }
  });
  if(selected) select.value=selected;
}

function openPassengerModal(prefSeat){
  document.getElementById("passengerModalTitle").textContent="Cadastrar passageiro";
  document.getElementById("editingId").value="";
  document.getElementById("passengerForm").reset();
  document.getElementById("travelMode").value="ambos";
  fillSeatOptions(prefSeat);
  if(prefSeat) document.getElementById("seat").value=prefSeat;
  document.getElementById("passengerModal").classList.add("show");
}

function closePassengerModal(){
  document.getElementById("passengerModal").classList.remove("show");
}

function savePassenger(){
  const name=document.getElementById("name").value.trim();
  const seat=Number(document.getElementById("seat").value);
  const id=document.getElementById("editingId").value;
  const travelMode=normalizeTravelMode(document.getElementById("travelMode").value);
  if(!name || !seat){ toast("Informe nome e poltrona."); return; }

  const conflict=app.passengers.find(p=>Number(p.seat)===seat && p.id!==id);
  if(conflict){ toast("Esta poltrona já está ocupada."); return; }

  pushUndo(id ? `edição de ${name}` : `cadastro de ${name}`);
  let notes=document.getElementById("notes").value.trim();
  notes=notes.replace(/somente\s+(ida|volta)/ig,"").replace(/\s{2,}/g," ").trim();
  if(travelMode==="volta") notes=[notes,"Somente volta"].filter(Boolean).join(" • ");
  if(travelMode==="ida") notes=[notes,"Somente ida"].filter(Boolean).join(" • ");

  const data={
    id:id || cryptoId(),
    name,
    seat,
    phone:document.getElementById("phone").value.trim(),
    course:document.getElementById("course").value.trim(),
    pickup:document.getElementById("pickup").value.trim(),
    notes,
    travelMode
  };

  if(id){
    const idx=app.passengers.findIndex(p=>p.id===id);
    app.passengers[idx]=data;
  }else{
    app.passengers.push(data);
  }
  applyTravelModeStatus(data.id,currentDate(),travelMode,true);
  saveApp();
  closePassengerModal();
  renderAll();
  toast(id ? "Passageiro atualizado." : "Passageiro cadastrado.");
}

function editPassenger(id){
  const p=app.passengers.find(x=>x.id===id);
  if(!p) return;
  document.getElementById("passengerModalTitle").textContent="Editar passageiro";
  document.getElementById("editingId").value=p.id;
  document.getElementById("name").value=p.name||"";
  document.getElementById("phone").value=p.phone||"";
  document.getElementById("course").value=p.course||"";
  document.getElementById("pickup").value=p.pickup||"";
  document.getElementById("notes").value=p.notes||"";
  document.getElementById("travelMode").value=passengerTravelMode(p);
  fillSeatOptions(p.seat);
  document.getElementById("seat").value=p.seat;
  document.getElementById("passengerModal").classList.add("show");
}

function deletePassenger(id){
  const p=app.passengers.find(x=>x.id===id);
  if(!p) return;
  if(!confirm(`Excluir ${p.name} da poltrona ${p.seat}?`)) return;
  pushUndo(`exclusão de ${p.name}`);
  app.passengers=app.passengers.filter(x=>x.id!==id);
  Object.values(app.daily).forEach(day=>{ if(day[id]) delete day[id]; });
  saveApp();
  renderAll();
  toast("Passageiro excluído.");
}

function movePassengerToWaiting(id){
  const p=app.passengers.find(x=>x.id===id);
  if(!p) return;
  const seat=Number(p.seat);
  if(!confirm(`Remover ${p.name} da poltrona ${String(seat).padStart(2,"0")} e enviar para a fila de espera?`)) return;

  pushUndo(`liberação da poltrona ${String(seat).padStart(2,"0")} de ${p.name}`);
  const date=currentDate();
  const direction=document.getElementById("direction")?.value||"ida";
  if(!app.waitingLists) app.waitingLists={};
  const list=getWaitingList(date).slice();
  const group=(p.course||"Sem grupo").trim() || "Sem grupo";
  const priority=getGroupPriority(group);
  const mode=passengerTravelMode(p);

  const sameGroup=list.filter(w=>(w.group||"Sem grupo")===group);
  const existingGroupIndex=sameGroup.length ? Number(sameGroup[0].groupIndex)||0 : null;
  const maxGroupIndex=list.reduce((m,w)=>Math.max(m,Number(w.groupIndex)||0),-1);
  const groupIndex=existingGroupIndex!==null ? existingGroupIndex : maxGroupIndex+1;
  const nextOrder=sameGroup.reduce((m,w)=>Math.max(m,Number(w.order)||0),0)+1;
  const newWaitingId=cryptoId();
  const manualActive=waitingManualOrderActive(list);
  const maxManual=list.reduce((m,w)=>Math.max(m,Number(w.manualOrder)||0),0);

  list.push({
    id:newWaitingId,
    name:p.name,
    group,
    priority,
    groupIndex,
    order:nextOrder,
    returnOnly:mode==="volta",
    travelMode:mode,
    manualOrder:manualActive?maxManual+1:undefined,
    phone:p.phone||"",
    pickup:p.pickup||"",
    notes:p.notes||""
  });

  app.waitingLists[date]=sortWaitingList(list);
  app.passengers=app.passengers.filter(x=>x.id!==id);
  Object.values(app.daily).forEach(day=>{ if(day[id]) delete day[id]; });
  saveApp();
  closeSeatModal();
  renderAll();

  const next=sortWaitingList(getWaitingList(date)).find(w=>w.id!==newWaitingId && isEligibleForDirection(w,direction));
  if(next && confirm(`A poltrona ${String(seat).padStart(2,"0")} ficou livre.

Próximo da fila para a ${direction}: ${next.name}.

Deseja colocar ${next.name} nesta poltrona agora?`)){
    allocateWaitingPassengerToSeat(next.id,seat,{skipUndo:true});
    return;
  }
  toast(`${p.name} saiu da poltrona ${String(seat).padStart(2,"0")} e foi para a fila de espera.`);
}

function openSeatModal(n){
  currentSeat=n;
  const p=passengerBySeat(n);
  const direction=document.getElementById("direction").value;
  document.getElementById("seatModalTitle").textContent=`Poltrona ${String(n).padStart(2,"0")}`;
  const body=document.getElementById("seatModalBody");
  const actions=document.getElementById("seatModalActions");

  if(!p){
    body.innerHTML=`<div class="empty">Esta poltrona está livre.</div>`;
    actions.innerHTML=`
      <button class="btn btn-outline" onclick="closeSeatModal()">Fechar</button>
      <button class="btn btn-primary" onclick="closeSeatModal();openPassengerModal(${n})">Cadastrar nesta poltrona</button>`;
  }else{
    const st=getPassengerStatus(p.id,direction);
    const mode=passengerTravelMode(p);
    const usesDirection=isEligibleForDirection(p,direction);
    body.innerHTML=`
      <div style="display:grid;gap:8px">
        <div><strong>${escapeHtml(p.name)}</strong></div>
        <div style="font-size:12px;color:var(--muted)">Curso: ${escapeHtml(p.course||"—")}</div>
        <div style="font-size:12px;color:var(--muted)">Telefone: ${escapeHtml(p.phone||"—")}</div>
        <div style="font-size:12px;color:var(--muted)">Ponto: ${escapeHtml(p.pickup||"—")}</div>
        <div style="font-size:12px;color:var(--muted)">Observação: ${escapeHtml(p.notes||"—")}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><span class="travel-mode-chip ${travelModeClass(mode)}">${travelModeLabel(mode)}</span><span class="status-chip ${chipClass(st,direction)}">${statusLabel(st,direction)}</span></div>
        <div class="manual-travel-box">
          <div class="manual-travel-title">Uso da viagem</div>
          <div class="manual-travel-buttons">
            <button type="button" class="travel-choice ${mode==='ambos'?'active':''}" onclick="setPassengerTravelModeManual('${p.id}','ambos');closeSeatModal()">Ida + volta</button>
            <button type="button" class="travel-choice ${mode==='ida'?'active':''}" onclick="setPassengerTravelModeManual('${p.id}','ida');closeSeatModal()">Só ida</button>
            <button type="button" class="travel-choice ${mode==='volta'?'active':''}" onclick="setPassengerTravelModeManual('${p.id}','volta');closeSeatModal()">Só volta</button>
          </div>
          <div class="manual-travel-help">Você pode alterar isso manualmente a qualquer momento.</div>
        </div>
        ${usesDirection?'':`<div class="direction-warning">Este aluno está marcado como <strong>${travelModeLabel(mode)}</strong> e não utiliza a ${direction}.</div>`}
      </div>
      <div class="status-actions">
        <button class="btn btn-primary" ${usesDirection?'':'disabled'} onclick="setPassengerStatus('${p.id}','${direction}','boarded');closeSeatModal()">
          ${direction==="ida" ? "Confirmar embarque" : "Confirmar retorno"}
        </button>
        <button class="btn btn-outline" ${usesDirection?'':'disabled'} onclick="setPassengerStatus('${p.id}','${direction}','pending');closeSeatModal()">Aguardando</button>
        <button class="btn btn-danger" ${usesDirection?'':'disabled'} onclick="setPassengerStatus('${p.id}','${direction}','absent');closeSeatModal()">
          ${direction==="ida" ? "Não vai / faltou" : "Não volta"}
        </button>
        <button class="btn btn-move-seat" onclick="startSeatMove(${n})">Mover para outra poltrona</button>
        <button class="btn btn-outline" onclick="closeSeatModal();editPassenger('${p.id}')">Editar cadastro</button>
        <button class="btn btn-warning" onclick="movePassengerToWaiting('${p.id}')">Remover da poltrona</button>
        <button class="btn btn-danger" onclick="closeSeatModal();deletePassenger('${p.id}')">Excluir aluno</button>
      </div>`;
    actions.innerHTML=`<button class="btn btn-outline" onclick="closeSeatModal()">Fechar</button>`;
  }
  document.getElementById("seatModal").classList.add("show");
}

function closeSeatModal(){
  document.getElementById("seatModal").classList.remove("show");
}


function openTextImportModal(){
  document.getElementById("textImportModal").classList.add("show");
  updateTextImportPreview();
}

function closeTextImportModal(){
  document.getElementById("textImportModal").classList.remove("show");
}

function normalizeName(name){
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPassengerName(value){
  let s = String(value || "").trim();
  let travelMode="ambos";
  if(/\(\s*volta\s*\)/i.test(s)) travelMode="volta";
  else if(/\(\s*ida\s*\)/i.test(s)) travelMode="ida";
  else if(/\(\s*ida\s*(?:e|\+|\/)\s*volta\s*\)/i.test(s)) travelMode="ambos";
  s = s
    .replace(/\(\s*ida\s*(?:e|\+|\/)\s*volta\s*\)/ig, "")
    .replace(/\(\s*(?:ida|volta)\s*\)/ig, "")
    .replace(/\s+/g," ").trim();
  return {name:s, returnOnly:travelMode==="volta", travelMode};
}

function parseDateFromList(value){
  const m = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if(!m) return null;
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if(year < 100) year += 2000;
  const month = Number(m[2]);
  const day = Number(m[1]);
  if(month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

function isGroupHeading(line){
  const s = String(line || "").trim();
  if(!s) return false;
  if(/semestre/i.test(s)) return true;
  if(/^uniplan$/i.test(s)) return true;
  return false;
}

function parseModelList(raw){
  const source = String(raw || "").split(/\r?\n/).map((v,i)=>({text:v.trim(),line:i+1}));
  const nonEmpty = source.filter(x=>x.text);
  const metadata = {title:"", date:null, destination:""};
  const seatRows = [];
  const groups = [];
  const errors = [];
  const seenSeats = new Map();
  let currentGroup = null;
  let seatBlockStarted = false;
  let seatBlockEnded = false;

  for(const item of nonEmpty){
    const line = item.text;

    const seatMatch = line.match(/^\(\s*(\d{1,2})\s*\)\s*(.*)$/);
    if(seatMatch){
      seatBlockStarted = true;
      currentGroup = null;
      const seat = Number(seatMatch[1]);
      const cleaned = cleanPassengerName(seatMatch[2]);
      const rowErrors = [];
      if(seat < 1 || seat > maxConfiguredSeatNumber()) rowErrors.push("poltrona inválida");
      else if(!isSeatActive(seat)) rowErrors.push("poltrona desabilitada neste ônibus");
      if(seenSeats.has(seat)) rowErrors.push(`poltrona duplicada (também na linha ${seenSeats.get(seat)})`);
      else seenSeats.set(seat,item.line);
      const row = {
        line:item.line,
        seat,
        name:cleaned.name,
        returnOnly:cleaned.returnOnly,
        travelMode:cleaned.travelMode,
        empty:!cleaned.name,
        errors:rowErrors,
        raw:line
      };
      seatRows.push(row);
      if(rowErrors.length) errors.push(row);
      continue;
    }

    if(seatBlockStarted && isGroupHeading(line)){
      seatBlockEnded = true;
      currentGroup = {name:line, people:[]};
      groups.push(currentGroup);
      continue;
    }

    if(seatBlockEnded){
      if(isGroupHeading(line)){
        currentGroup = {name:line, people:[]};
        groups.push(currentGroup);
        continue;
      }
      const personMatch = line.match(/^\s*(\d{1,2})\s*[-.)]\s*(.+)$/);
      if(personMatch && currentGroup){
        const cleaned = cleanPassengerName(personMatch[2]);
        if(cleaned.name){
          currentGroup.people.push({
            order:Number(personMatch[1]),
            name:cleaned.name,
            returnOnly:cleaned.returnOnly,
            travelMode:cleaned.travelMode,
            line:item.line
          });
        }
        continue;
      }
      // Qualquer linha textual depois do bloco de assentos pode iniciar um grupo novo.
      if(!/^\d/.test(line)){
        currentGroup = {name:line, people:[]};
        groups.push(currentGroup);
        continue;
      }
    }

    // Metadados no cabeçalho, antes do primeiro assento.
    if(!seatBlockStarted){
      const parsedDate = parseDateFromList(line);
      if(parsedDate && !metadata.date){ metadata.date = parsedDate; continue; }
      if(/^lista\b/i.test(line) && !metadata.title){ metadata.title = line; continue; }
      if(!metadata.destination){ metadata.destination = line; continue; }
    }
  }

  return {metadata, seatRows, groups:groups.filter(g=>g.people.length || isGroupHeading(g.name)), errors, model:true};
}

function splitImportLine(line){
  if(line.includes(";")) return line.split(";").map(v=>v.trim());
  if(line.includes("\t")) return line.split("\t").map(v=>v.trim());
  if(line.includes("|")) return line.split("|").map(v=>v.trim());
  if(/\s+-\s+/.test(line)) return line.split(/\s+-\s+/).map(v=>v.trim());
  return [line.trim()];
}

function parseGenericList(raw){
  const sourceLines = String(raw || "").split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const seatRows=[];
  const errors=[];
  const seenSeats=new Map();

  sourceLines.forEach((line,index)=>{
    if(index===0 && /poltrona|assento/i.test(line) && /nome|passageiro/i.test(line)) return;
    let parts=splitImportLine(line).filter(v=>v!=="");
    let seat=null;
    let name="";
    const first=parts[0]||"";
    const direct=first.match(/^(?:poltrona|assento)?\s*#?\s*(\d{1,2})(?:\s*[.)\-:]\s*)?$/i);
    if(direct){ seat=Number(direct[1]); parts.shift(); }
    else{
      const leading=line.match(/^(?:poltrona|assento)?\s*#?\s*(\d{1,2})\s*[.)\-:]\s*(.+)$/i);
      if(leading){ seat=Number(leading[1]); parts=[leading[2].trim()]; }
    }
    if(seat===null && parts.length>1 && /^\d{1,2}$/.test(parts[0])) seat=Number(parts.shift());
    if(seat===null) return;
    const cleaned=cleanPassengerName(parts[0]||"");
    name=cleaned.name;
    const rowErrors=[];
    if(seat<1 || seat>maxConfiguredSeatNumber()) rowErrors.push("poltrona inválida");
    else if(!isSeatActive(seat)) rowErrors.push("poltrona desabilitada neste ônibus");
    if(!name) rowErrors.push("nome não identificado");
    if(seenSeats.has(seat)) rowErrors.push(`poltrona duplicada (também na linha ${seenSeats.get(seat)})`);
    else seenSeats.set(seat,index+1);
    const row={line:index+1,seat,name,returnOnly:cleaned.returnOnly,travelMode:cleaned.travelMode,empty:false,errors:rowErrors,raw:line};
    seatRows.push(row);
    if(rowErrors.length) errors.push(row);
  });
  return {metadata:{title:"",date:null,destination:""},seatRows,groups:[],errors,model:false};
}

function parseTextImport(){
  const raw = document.getElementById("textImportArea").value || "";
  if(!raw.trim()) return {metadata:{title:"",date:null,destination:""},seatRows:[],groups:[],errors:[],model:true};
  const hasSeatModel = /^\s*\(\s*\d{1,2}\s*\)/m.test(raw);
  return hasSeatModel ? parseModelList(raw) : parseGenericList(raw);
}

function formatListDate(iso){
  if(!iso) return "";
  const [y,m,d]=iso.split("-");
  return `${d}/${m}/${y}`;
}

function updateTextImportPreview(){
  const parsed = parseTextImport();
  const body = document.getElementById("textImportPreviewBody");
  const count = document.getElementById("textImportCount");
  const warnings = document.getElementById("textImportWarnings");
  const meta = document.getElementById("textImportMeta");
  const groupsBox = document.getElementById("textImportGroups");

  const occupied=parsed.seatRows.filter(r=>!r.empty && !r.errors.length);
  const emptySeats=parsed.seatRows.filter(r=>r.empty && !r.errors.length);
  count.textContent = `${occupied.length} ocupada${occupied.length===1?"":"s"} • ${emptySeats.length} livre${emptySeats.length===1?"":"s"}`;

  const chips=[];
  if(parsed.metadata.title) chips.push(`<span>${escapeHtml(parsed.metadata.title)}</span>`);
  if(parsed.metadata.date) chips.push(`<span>📅 ${escapeHtml(formatListDate(parsed.metadata.date))}</span>`);
  if(parsed.metadata.destination) chips.push(`<span>📍 ${escapeHtml(parsed.metadata.destination)}</span>`);
  meta.innerHTML = chips.length ? `<div class="import-meta-row">${chips.join("")}</div>` : "";

  if(!parsed.seatRows.length){
    body.innerHTML = `<div class="empty" style="margin:12px">Cole a lista acima para visualizar.</div>`;
  }else{
    body.innerHTML = parsed.seatRows.map(r=>`
      <div class="import-preview-row ${r.errors.length ? "import-error" : (r.empty ? "import-empty" : "")}">
        <div class="import-seat">${String(r.seat).padStart(2,"0")}</div>
        <div>
          <strong>${r.empty ? "Livre" : escapeHtml(r.name)}</strong>
          ${!r.empty && r.travelMode!=="ambos" ? `<div class="import-note">${travelModeLabel(r.travelMode)}</div>` : ""}
          ${r.errors.length ? `<div class="import-line-error">Linha ${r.line}: ${escapeHtml(r.errors.join(", "))}</div>` : ""}
        </div>
      </div>`).join("");
  }

  if(parsed.groups.length){
    const total=parsed.groups.reduce((sum,g)=>sum+g.people.length,0);
    groupsBox.innerHTML = `
      <div class="import-groups-head"><strong>Fila detectada</strong><span>${total} aluno${total===1?"":"s"}</span></div>
      <div class="import-groups-summary">
        ${parsed.groups.map(g=>`<span class="import-group-summary-chip"><strong>${escapeHtml(g.name)}</strong><b>${g.people.length}</b></span>`).join("")}
      </div>
      <div class="import-groups-note import-groups-note-compact">Será adicionada à fila por prioridade.</div>`;
  }else groupsBox.innerHTML="";

  if(parsed.errors.length){
    warnings.innerHTML = `<div class="import-warning"><strong>Atenção:</strong> ${parsed.errors.length} linha(s) de poltrona têm problema e precisam ser corrigidas.</div>`;
  }else if(parsed.seatRows.length){
    const activeSeats=configuredSeatNumbers();
    const missingConfigured=parsed.model ? activeSeats.filter(n=>!parsed.seatRows.some(r=>r.seat===n)) : [];
    warnings.innerHTML = `<div class="import-warning import-ok"><strong>Pronto para importar.</strong>${missingConfigured.length?` ${missingConfigured.length} poltrona(s) não citada(s) serão mantidas.`:''}</div>`;
  }else warnings.innerHTML="";
}

function applyReturnOnlyStatus(passengerId,date){
  applyTravelModeStatus(passengerId,date,"volta",true);
}

function applyTextImport(mode){
  const parsed = parseTextImport();
  if(!parsed.seatRows.length){ toast("Nenhuma poltrona foi encontrada na lista."); return; }
  if(parsed.errors.length){ toast("Corrija as linhas destacadas antes de importar."); return; }

  const activeRows=parsed.seatRows.filter(r=>!r.empty);
  const nameSeen=new Map();
  const duplicateNames=[];
  activeRows.forEach(r=>{
    const key=normalizeName(r.name);
    if(nameSeen.has(key)) duplicateNames.push(r.name);
    else nameSeen.set(key,true);
  });
  if(duplicateNames.length){
    alert("Há nomes duplicados nas poltronas: " + duplicateNames.join(", ") + ". Ajuste a lista antes de continuar.");
    return;
  }

  const importDate = parsed.metadata.date || currentDate();
  if(mode==="sync"){
    const occupied=activeRows.length;
    const empties=parsed.seatRows.filter(r=>r.empty).length;
    if(!confirm(`Sincronizar ${parsed.seatRows.length} poltrona(s)?\n\n${occupied} serão preenchidas e ${empties} serão liberadas conforme o texto. Poltronas que não aparecem na lista serão preservadas.`)) return;
    pushUndo("sincronização da lista em texto");

    const affectedSeats=new Set(parsed.seatRows.map(r=>Number(r.seat)));
    const listedNames=new Set(activeRows.map(r=>normalizeName(r.name)));
    const existingByName=new Map(app.passengers.map(p=>[normalizeName(p.name),p]));

    // Remove ocupantes das poltronas explicitamente descritas, exceto quem também aparece nominalmente na nova lista.
    const removedIds=new Set();
    app.passengers=app.passengers.filter(p=>{
      const isAffected=affectedSeats.has(Number(p.seat));
      const isListed=listedNames.has(normalizeName(p.name));
      if(isAffected && !isListed){ removedIds.add(p.id); return false; }
      return true;
    });

    // Reposiciona/cadastra os passageiros da lista.
    for(const r of activeRows){
      let existing=app.passengers.find(p=>normalizeName(p.name)===normalizeName(r.name)) || existingByName.get(normalizeName(r.name));
      if(existing && removedIds.has(existing.id)) existing=null;

      // Se o assento ainda tiver alguém, a lista atual é soberana naquele assento.
      const owner=app.passengers.find(p=>Number(p.seat)===Number(r.seat) && (!existing || p.id!==existing.id));
      if(owner){
        app.passengers=app.passengers.filter(p=>p.id!==owner.id);
        removedIds.add(owner.id);
      }

      const travelMode=normalizeTravelMode(r.travelMode,"",!!r.returnOnly);
      if(existing){
        existing.seat=r.seat;
        existing.name=r.name;
        existing.travelMode=travelMode;
        existing.notes=notesForTravelMode(existing.notes||"",travelMode);
      }else{
        existing={id:cryptoId(),name:r.name,seat:r.seat,phone:"",course:"",pickup:"",notes:notesForTravelMode("",travelMode),travelMode};
        app.passengers.push(existing);
      }
      applyTravelModeStatus(existing.id,importDate,travelMode,true);
    }

    // Remove status de quem saiu definitivamente do cadastro.
    Object.values(app.daily).forEach(day=>{
      removedIds.forEach(id=>{ if(day[id]) delete day[id]; });
    });
  }else{
    pushUndo("atualização da lista em texto");
    let conflicts=[];
    for(const r of activeRows){
      let existing=app.passengers.find(p=>normalizeName(p.name)===normalizeName(r.name));
      const owner=app.passengers.find(p=>Number(p.seat)===Number(r.seat) && (!existing || p.id!==existing.id));
      if(owner){ conflicts.push(`Poltrona ${r.seat}: ${owner.name}`); continue; }
      const travelMode=normalizeTravelMode(r.travelMode,"",!!r.returnOnly);
      if(existing){
        existing.seat=r.seat;
        existing.name=r.name;
        existing.travelMode=travelMode;
        existing.notes=notesForTravelMode(existing.notes||"",travelMode);
      }else{
        existing={id:cryptoId(),name:r.name,seat:r.seat,phone:"",course:"",pickup:"",notes:notesForTravelMode("",travelMode),travelMode};
        app.passengers.push(existing);
      }
      applyTravelModeStatus(existing.id,importDate,travelMode,true);
    }
    if(conflicts.length) alert("Algumas poltronas já estavam ocupadas e não foram alteradas:\n\n"+conflicts.join("\n"));
  }

  // Guarda as listas adicionais no backup, sem tratá-las como poltronas.
  if(!app.extraGroups) app.extraGroups={};
  if(parsed.groups.length){
    app.extraGroups[importDate]={
      title:parsed.metadata.title||"",
      destination:parsed.metadata.destination||"",
      groups:parsed.groups
    };
  }

  // Converte os grupos adicionais em lista de espera para a data importada.
  if(parsed.groups.length){
    buildWaitingListFromGroups(parsed.groups,importDate);
  }else if(app.waitingLists){
    app.waitingLists[importDate]=[];
  }

  if(parsed.metadata.date) document.getElementById("tripDate").value=parsed.metadata.date;
  if(parsed.metadata.destination){
    document.getElementById("destination").value=parsed.metadata.destination;
    app.config.destination=parsed.metadata.destination;
  }

  saveApp();
  closeTextImportModal();
  renderAll();
  toast(mode==="sync" ? "Lista sincronizada com o mapa." : "Passageiros preenchidos foram atualizados.");
}

function weekdayLabelFromISO(iso){
  const names=["Domingo","Segunda-Feira","Terça-Feira","Quarta-Feira","Quinta-Feira","Sexta-Feira","Sábado"];
  if(!iso) return "";
  const d=new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : names[d.getDay()];
}

function shortDateFromISO(iso){
  if(!iso) return "";
  const parts=String(iso).split("-");
  if(parts.length!==3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function travelModeTextSuffix(mode){
  mode=normalizeTravelMode(mode);
  if(mode==="ida") return " (ida)";
  if(mode==="volta") return " (volta)";
  return "";
}

function generateCurrentListText(){
  const date=currentDate();
  const weekday=weekdayLabelFromISO(date);
  const destination=(document.getElementById("destination")?.value||app.config?.destination||"Faculdade").trim();
  const lines=[];
  lines.push(`Lista ${weekday}`.trim());
  lines.push(shortDateFromISO(date));
  if(destination) lines.push(destination);
  const activeBus=getActiveBus();
  if(activeBus) lines.push(`Ônibus: ${activeBus.name}`);
  const driverName=(app.config?.driverName||"").trim();
  if(driverName) lines.push(`Motorista: ${driverName}`);
  lines.push(`Capacidade: ${configuredCapacity()} lugares`);
  lines.push("");

  configuredSeatNumbers().forEach(seat=>{
    const p=passengerBySeat(seat);
    const suffix=p ? travelModeTextSuffix(passengerTravelMode(p)) : "";
    lines.push(`(${seat})${p ? ` ${p.name}${suffix}` : ""}`);
  });

  const waiting=sortWaitingList(getWaitingList(date));
  if(waiting.length){
    lines.push("");
    lines.push("Lista de Espera");
    if(waitingManualOrderActive(waiting)){
      lines.push("(A ordem manual está ativa no sistema)");
    }

    // Mantém o formato original por grupos/semestres, respeitando a primeira aparição
    // de cada grupo na fila atual.
    const groups=[];
    const groupMap=new Map();
    waiting.forEach(person=>{
      const group=(person.group||"Sem grupo").trim()||"Sem grupo";
      if(!groupMap.has(group)){
        const entry={name:group,people:[]};
        groupMap.set(group,entry);
        groups.push(entry);
      }
      groupMap.get(group).people.push(person);
    });

    groups.forEach((group,groupIndex)=>{
      if(groupIndex>0) lines.push("");
      lines.push(group.name);
      group.people.forEach((person,index)=>{
        lines.push(`${index+1}- ${person.name}${travelModeTextSuffix(waitingTravelMode(person))}`);
      });
    });
  }

  return lines.join("\n");
}

function refreshGeneratedText(){
  const area=document.getElementById("generatedTextArea");
  if(!area) return;
  area.value=generateCurrentListText();
  const date=currentDate();
  const occupied=app.passengers.length;
  const waiting=getWaitingList(date).length;
  const dateChip=document.getElementById("generateTextDateChip");
  const occupiedChip=document.getElementById("generateTextOccupiedChip");
  const waitingChip=document.getElementById("generateTextWaitingChip");
  if(dateChip) dateChip.textContent=`${weekdayLabelFromISO(date)} • ${shortDateFromISO(date)}`;
  if(occupiedChip) occupiedChip.textContent=`${occupied} ocupada${occupied===1?"":"s"}`;
  if(waitingChip) waitingChip.textContent=`${waiting} na espera`;
}

function openGenerateTextModal(){
  refreshGeneratedText();
  const modal=document.getElementById("generateTextModal");
  if(modal) modal.classList.add("show");
}

function closeGenerateTextModal(){
  const modal=document.getElementById("generateTextModal");
  if(modal) modal.classList.remove("show");
}

async function copyGeneratedText(){
  refreshGeneratedText();
  const area=document.getElementById("generatedTextArea");
  if(!area) return;
  const value=area.value;
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(value);
    }else{
      area.focus();
      area.select();
      document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
    toast("Lista copiada para a área de transferência.",true);
  }catch(err){
    area.focus();
    area.select();
    toast("Selecione o texto e copie manualmente com Ctrl+C.",true);
  }
}

function downloadGeneratedText(){
  refreshGeneratedText();
  const content=document.getElementById("generatedTextArea")?.value||"";
  downloadFile(`lista-onibus-${currentDate()}.txt`,content,"text/plain;charset=utf-8;");
}

function imageExportSlug(value){
  return String(value||"onibus")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-|-$/g,"") || "onibus";
}

function formatExportDate(dateValue){
  const m=String(dateValue||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(dateValue||"");
}

function canvasRoundRect(ctx,x,y,w,h,r,fill,stroke,lineWidth=2){
  const radius=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+radius,y);
  ctx.arcTo(x+w,y,x+w,y+h,radius);
  ctx.arcTo(x+w,y+h,x,y+h,radius);
  ctx.arcTo(x,y+h,x,y,radius);
  ctx.arcTo(x,y,x+w,y,radius);
  ctx.closePath();
  if(fill){ ctx.fillStyle=fill; ctx.fill(); }
  if(stroke){ ctx.lineWidth=lineWidth; ctx.strokeStyle=stroke; ctx.stroke(); }
}

function canvasTextFit(ctx,text,maxWidth){
  const value=String(text||"");
  if(ctx.measureText(value).width<=maxWidth) return value;
  let out=value;
  while(out.length>1 && ctx.measureText(out+"…").width>maxWidth) out=out.slice(0,-1);
  return out+"…";
}

function exportSeatPalette(status,direction){
  if(status==="boarded" && direction==="volta") return {fill:"#e3edff",stroke:"#99b8ef",text:"#2359a7",label:"RETORNOU"};
  if(status==="boarded") return {fill:"#ddf4e9",stroke:"#79c9a5",text:"#176e47",label:"EMBARCOU"};
  if(status==="absent") return {fill:"#fde5e5",stroke:"#e8a0a0",text:"#9d3030",label:"NÃO VAI"};
  return {fill:"#fff5d9",stroke:"#f0cf72",text:"#8f6400",label:"AGUARDANDO"};
}

function drawExportSeat(ctx,seat,x,y,w,h,direction){
  if(!isSeatActive(seat)){
    canvasRoundRect(ctx,x,y,w,h,16,"#e3e7ee","#b7c0cf",3);
    ctx.fillStyle="#8d98aa";
    ctx.font="800 12px system-ui, sans-serif";
    ctx.textAlign="left";
    ctx.fillText(seatPositionLabel(seat),x+14,y+20);
    ctx.font="900 24px system-ui, sans-serif";
    ctx.fillText(String(seat).padStart(2,"0"),x+14,y+50);
    ctx.textAlign="right";
    ctx.font="900 10px system-ui, sans-serif";
    ctx.fillText("DESABILITADA",x+w-12,y+48);
    return;
  }
  const p=passengerBySeat(seat);
  if(!p){
    canvasRoundRect(ctx,x,y,w,h,16,"#eef2f7","#d7dce5",3);
    ctx.fillStyle="#7a8498";
    ctx.font="800 13px system-ui, sans-serif";
    ctx.textAlign="left";
    ctx.fillText(seatPositionLabel(seat),x+14,y+21);
    ctx.font="900 25px system-ui, sans-serif";
    ctx.fillText(String(seat).padStart(2,"0"),x+14,y+52);
    ctx.font="700 13px system-ui, sans-serif";
    ctx.textAlign="right";
    ctx.fillText("LIVRE",x+w-14,y+50);
    return;
  }
  const status=getPassengerStatus(p.id,direction);
  const pal=exportSeatPalette(status,direction);
  canvasRoundRect(ctx,x,y,w,h,16,pal.fill,pal.stroke,3);
  ctx.fillStyle=pal.text;
  ctx.textAlign="left";
  ctx.font="800 12px system-ui, sans-serif";
  ctx.fillText(seatPositionLabel(seat),x+14,y+19);
  ctx.font="900 24px system-ui, sans-serif";
  ctx.fillText(String(seat).padStart(2,"0"),x+14,y+49);
  ctx.font="800 15px system-ui, sans-serif";
  const name=canvasTextFit(ctx,p.name,w-28);
  ctx.fillText(name,x+14,y+72);
  ctx.textAlign="right";
  ctx.font="900 9px system-ui, sans-serif";
  ctx.fillText(pal.label,x+w-12,y+18);
  const mode=passengerTravelMode(p);
  if(mode && mode!=="ambos"){
    ctx.font="900 9px system-ui, sans-serif";
    ctx.fillText(mode==="ida"?"SÓ IDA":"SÓ VOLTA",x+w-12,y+35);
  }
}

async function downloadBusImage(){
  const activeBus=getActiveBus();
  const busName=activeBus?.name || "Ônibus";
  const driver=(app.config?.driverName||"Não informado").trim() || "Não informado";
  const destination=(document.getElementById("destination")?.value||app.config?.destination||"Faculdade").trim();
  const shift=document.getElementById("shift")?.value||app.config?.shift||"";
  const direction=document.getElementById("direction")?.value||"ida";
  const directionLabel=direction==="volta" ? "Volta da faculdade" : "Ida para faculdade";
  const date=currentDate();
  const button=document.querySelector(".btn-download-bus");
  const previousText=button?.textContent;
  if(button){ button.disabled=true; button.textContent="Gerando imagem…"; }

  try{
    const width=1200;
    const extraCount=normalizeSeatConfig(app.seatConfig).extraCount;
    const extraRows=Math.ceil(extraCount/4);
    const height=1900+(extraRows*105);
    const canvas=document.createElement("canvas");
    canvas.width=width;
    canvas.height=height;
    const ctx=canvas.getContext("2d");
    if(!ctx) throw new Error("Canvas indisponível");

    // Fundo
    const bg=ctx.createLinearGradient(0,0,0,height);
    bg.addColorStop(0,"#f7f9fe");
    bg.addColorStop(1,"#edf3fb");
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,width,height);

    // Cabeçalho
    const head=ctx.createLinearGradient(70,55,1130,230);
    head.addColorStop(0,"#0e1628");
    head.addColorStop(.6,"#162341");
    head.addColorStop(1,"#1f3b7a");
    canvasRoundRect(ctx,70,55,1060,190,28,head,null,0);
    ctx.textAlign="left";
    ctx.fillStyle="#bfcbe7";
    ctx.font="900 15px system-ui, sans-serif";
    ctx.fillText("MAPABUS FACULDADE",105,95);
    ctx.fillStyle="#ffffff";
    ctx.font="950 36px system-ui, sans-serif";
    ctx.fillText(canvasTextFit(ctx,busName,600),105,142);
    ctx.fillStyle="#dce5f8";
    ctx.font="700 16px system-ui, sans-serif";
    ctx.fillText(`${formatExportDate(date)}  •  ${destination||"—"}  •  ${shift||"—"}`,105,181);
    ctx.fillText(`${directionLabel}  •  Motorista: ${driver}`,105,213);

    // Corpo do ônibus
    const busX=115,busY=290,busW=970,busH=1450+(extraRows*105);
    canvasRoundRect(ctx,busX,busY,busW,busH,42,"#f8fbff","#1b2740",6);
    canvasRoundRect(ctx,460,busY-18,280,38,19,"#1b2740",null,0);
    ctx.fillStyle="#ffffff";
    ctx.textAlign="center";
    ctx.font="900 13px system-ui, sans-serif";
    ctx.fillText("FRENTE DO ÔNIBUS",600,busY+7);

    // Motorista, poltrona 49 e porta
    canvasRoundRect(ctx,155,345,260,105,18,"#ffffff","#b8c4da",3);
    ctx.fillStyle="#6f7890";
    ctx.textAlign="center";
    ctx.font="900 12px system-ui, sans-serif";
    ctx.fillText("MOTORISTA",285,378);
    ctx.fillStyle="#172033";
    ctx.font="900 21px system-ui, sans-serif";
    ctx.fillText(canvasTextFit(ctx,driver,220),285,414);

    drawExportSeat(ctx,49,492,345,215,105,direction);

    canvasRoundRect(ctx,785,345,260,105,18,"#ffffff","#b8c4da",3);
    ctx.fillStyle="#6f7890";
    ctx.textAlign="center";
    ctx.font="900 16px system-ui, sans-serif";
    ctx.fillText("PORTA",915,405);

    // Fileiras 1 a 48 no mesmo mapeamento da tela.
    const seatW=185, seatH=80, gap=17, aisle=92;
    const leftX=155;
    const secondX=leftX+seatW+gap;
    const thirdX=secondX+seatW+aisle;
    const fourthX=thirdX+seatW+gap;
    let y=495;
    const rowGap=17;
    for(let row=0;row<12;row++){
      const start=row*4+1;
      drawExportSeat(ctx,start,leftX,y,seatW,seatH,direction);
      drawExportSeat(ctx,start+1,secondX,y,seatW,seatH,direction);
      drawExportSeat(ctx,start+3,thirdX,y,seatW,seatH,direction);
      drawExportSeat(ctx,start+2,fourthX,y,seatW,seatH,direction);
      ctx.save();
      ctx.translate(600,y+seatH/2);
      ctx.rotate(-Math.PI/2);
      ctx.fillStyle="#9aa7ba";
      ctx.textAlign="center";
      ctx.font="900 10px system-ui, sans-serif";
      ctx.fillText("CORREDOR",0,0);
      ctx.restore();
      y += seatH+rowGap;
    }

    if(extraCount>0){
      ctx.fillStyle="#66758d";
      ctx.textAlign="left";
      ctx.font="900 12px system-ui, sans-serif";
      ctx.fillText("POLTRONAS ADICIONAIS",leftX,y+15);
      y+=30;
      const xs=[leftX,secondX,thirdX,fourthX];
      for(let i=0;i<extraCount;i++){
        const seat=50+i;
        const col=i%4;
        const row=Math.floor(i/4);
        drawExportSeat(ctx,seat,xs[col],y+row*(seatH+rowGap),seatW,seatH,direction);
      }
    }

    // Rodapé / legenda
    const occupied=app.passengers.length;
    const free=freeSeatNumbers().length;
    const waiting=getWaitingList().length;
    ctx.textAlign="left";
    ctx.font="900 15px system-ui, sans-serif";
    const legendY=1790+(extraRows*105);
    const legends=[
      ["#eef2f7","#7a8498","Livre"],
      ["#fff5d9","#8f6400","Aguardando"],
      [direction==="volta"?"#e3edff":"#ddf4e9",direction==="volta"?"#2359a7":"#176e47",direction==="volta"?"Retornou":"Embarcou"],
      ["#fde5e5","#9d3030","Não vai"]
    ];
    let lx=105;
    legends.forEach(([fill,color,label])=>{
      ctx.fillStyle=fill;ctx.strokeStyle=color;ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(lx,legendY,9,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#5f6d82";ctx.font="800 13px system-ui, sans-serif";
      ctx.fillText(label,lx+18,legendY+5);
      lx+=150;
    });
    ctx.textAlign="right";
    ctx.fillStyle="#31425f";
    ctx.font="900 15px system-ui, sans-serif";
    ctx.fillText(`${configuredCapacity()} lugares  •  ${occupied} ocupadas  •  ${free} livres  •  ${waiting} na espera`,1095,legendY+5);

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png",1));
    if(!blob) throw new Error("Não foi possível criar o PNG");
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`mapa-${imageExportSlug(busName)}-${date}-${direction}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast("Imagem do ônibus gerada em PNG.",true);
  }catch(err){
    console.error(err);
    toast("Não foi possível gerar a imagem do ônibus neste navegador.",true);
  }finally{
    if(button){ button.disabled=false; button.textContent=previousText||"⬇ Baixar imagem do ônibus"; }
  }
}

function clearToday(){
  const date=currentDate();
  if(!confirm(`Limpar todas as marcações de ida e volta de ${date}? Os cadastros serão mantidos.`)) return;
  pushUndo(`limpeza das marcações de ${date}`);
  app.daily[date]={};
  saveApp();
  renderAll();
  toast("Marcações do dia foram limpas.");
}

function exportBackup(){
  app.config.destination=document.getElementById("destination").value;
  app.config.shift=document.getElementById("shift").value;
  saveApp();
  const activeBus=getActiveBus();
  const busSlug=(activeBus?.name||"onibus").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"onibus";
  downloadFile(
    `mapabus-backup-${busSlug}-${currentDate()}.json`,
    JSON.stringify(app,null,2),
    "application/json"
  );
}

function exportCSV(){
  const header=["Poltrona","Nome","Curso","Ponto","Telefone","Uso","Ida","Volta"];
  const rows=app.passengers.slice().sort((a,b)=>a.seat-b.seat).map(p=>[
    p.seat,p.name,p.course||"",p.pickup||"",p.phone||"",travelModeLabel(passengerTravelMode(p)),
    statusLabel(getPassengerStatus(p.id,"ida"),"ida"),
    statusLabel(getPassengerStatus(p.id,"volta"),"volta")
  ]);
  const csv=[header,...rows].map(r=>r.map(csvCell).join(";")).join("\n");
  const activeBus=getActiveBus();
  const busSlug=(activeBus?.name||"onibus").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"onibus";
  downloadFile(`passageiros-${busSlug}-${currentDate()}.csv`, "\ufeff"+csv, "text/csv;charset=utf-8;");
}

function csvCell(v){
  const s=String(v??"");
  return `"${s.replaceAll('"','""')}"`;
}

function downloadFile(name,content,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("textImportArea").addEventListener("input",updateTextImportPreview);

document.getElementById("importFile").addEventListener("change",e=>{
  const file=e.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      if(!data || (!Array.isArray(data.passengers) && !Array.isArray(data.buses))) throw new Error();
      pushUndo("importação de backup");
      app={...defaultApp(),...data};
      migrateAppData();
      ensureBusSystem();
      refreshBusFormFields();
      saveApp();
      renderAll();
      toast("Backup importado com sucesso.");
    }catch(err){ alert("Arquivo de backup inválido."); }
  };
  reader.readAsText(file);
  e.target.value="";
});

document.getElementById("tripDate").addEventListener("change",renderAll);
document.getElementById("direction").addEventListener("change",renderAll);
document.getElementById("searchInput").addEventListener("input",renderTable);
document.getElementById("destination").addEventListener("change",e=>{app.config.destination=e.target.value;saveApp()});
document.getElementById("shift").addEventListener("change",e=>{app.config.shift=e.target.value;saveApp()});

let toastTimer=null;
function toast(msg,noUndo=false){
  const t=document.getElementById("toast");
  if(!t) return;
  if(toastTimer) clearTimeout(toastTimer);
  t.innerHTML="";
  const span=document.createElement("span");
  span.className="toast-message";
  span.textContent=msg;
  t.appendChild(span);
  if(!noUndo && undoStack.length){
    const btn=document.createElement("button");
    btn.className="toast-undo";
    btn.type="button";
    btn.textContent="Desfazer";
    btn.onclick=()=>undoLastAction();
    t.appendChild(btn);
  }
  t.classList.add("show");
  toastTimer=setTimeout(()=>t.classList.remove("show"),4200);
}

function cryptoId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-"+Date.now()+"-"+Math.random().toString(36).slice(2);
}

function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

document.getElementById("tripDate").value=todayISO();
refreshBusFormFields();
renderAll();

window.addEventListener("click",e=>{
  if(e.target.classList.contains("modal")) e.target.classList.remove("show");
});


/* ===== Tema claro / escuro ===== */
function getCurrentTheme(){
  return document.documentElement.dataset.theme || "light";
}

function applyTheme(theme, persist=true){
  const finalTheme = theme==="dark" ? "dark" : "light";
  document.documentElement.dataset.theme=finalTheme;
  if(persist){
    try{ localStorage.setItem("mapabus_theme",finalTheme); }catch(e){}
  }
  const btn=document.getElementById("themeToggleBtn");
  if(btn){
    btn.textContent=finalTheme==="dark" ? "☀ Tema claro" : "☾ Tema escuro";
    btn.setAttribute("aria-label",finalTheme==="dark" ? "Ativar tema claro" : "Ativar tema escuro");
  }
}

function toggleTheme(){
  applyTheme(getCurrentTheme()==="dark" ? "light" : "dark");
}

document.addEventListener("DOMContentLoaded",()=>{
  applyTheme(getCurrentTheme(),false);
});
