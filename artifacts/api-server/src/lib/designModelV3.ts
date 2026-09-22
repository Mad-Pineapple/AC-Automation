/**
 * Layout Engine v3: deterministic Design Model.
 *
 * Converts an approved KV into nested assemblies and then constrains an
 * adapted layout to those relationships. This is deliberately not AI.
 * The master is the source of truth.
 */
import type { FreeformConfig, FreeformElement, FreeformImage, FreeformRect, FreeformText, SlotRole } from "./freeform";

export type AssemblyKind = "hero" | "copy" | "cta" | "brand" | "logo" | "decoration" | "other";
export type AssemblyBehaviour = "locked-shape" | "connected" | "stack" | "repeat" | "flex";
export type LayoutFamilyV3 = "wide" | "landscape" | "square" | "portrait" | "tall";

export interface DesignMemberV3 {
  id: string;
  slot?: SlotRole;
  type: FreeformElement["type"];
  x: number; y: number; w: number; h: number;
}
export interface DesignAssemblyV3 {
  id: string;
  kind: AssemblyKind;
  behaviour: AssemblyBehaviour;
  members: DesignMemberV3[];
  parentId?: string;
  bounds: { x: number; y: number; w: number; h: number };
  /** Internal geometry may only receive one uniform scale + translation. */
  lockInternalGeometry: boolean;
}
export interface DesignRelationV3 {
  a: string;
  b: string;
  kind: "center-x" | "center-y" | "below" | "right-of";
  tolerance: number;
  gap?: number;
}
export interface DesignModelV3 {
  version: 3;
  source: { width: number; height: number };
  family: LayoutFamilyV3;
  pattern: string[];
  assemblies: DesignAssemblyV3[];
  relations: DesignRelationV3[];
  safeMargin: { x: number; y: number };
}

const box = (els: FreeformElement[]) => {
  const x0 = Math.min(...els.map(e => e.x)), y0 = Math.min(...els.map(e => e.y));
  const x1 = Math.max(...els.map(e => e.x + e.w)), y1 = Math.max(...els.map(e => e.y + e.h));
  return { x: x0, y: y0, w: Math.max(1, x1-x0), h: Math.max(1, y1-y0) };
};
const cx = (e: {x:number,w:number}) => e.x + e.w/2;
const cy = (e: {y:number,h:number}) => e.y + e.h/2;
const contains = (a: FreeformElement, b: FreeformElement, pad=2) => b.x >= a.x-pad && b.y >= a.y-pad && b.x+b.w <= a.x+a.w+pad && b.y+b.h <= a.y+a.h+pad;
const overlaps = (a: FreeformElement, b: FreeformElement) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
const member = (e: FreeformElement): DesignMemberV3 => ({ id:e.id, slot:e.slot, type:e.type, x:e.x,y:e.y,w:e.w,h:e.h });

export function layoutFamilyV3(w:number,h:number): LayoutFamilyV3 {
  const r=w/Math.max(1,h);
  if (r>=3) return "wide";
  if (r>=1.18) return "landscape";
  if (r>=0.82) return "square";
  if (r>=0.48) return "portrait";
  return "tall";
}

function pillCandidates(elements: FreeformElement[]): Array<{rect:FreeformRect;text:FreeformText;icon?:FreeformElement}> {
  const rects=elements.filter((e):e is FreeformRect=>e.type==="rect" && e.w>e.h*1.25);
  const texts=elements.filter((e):e is FreeformText=>e.type==="text" && e.text.trim().length>0);
  const out:Array<{rect:FreeformRect;text:FreeformText;icon?:FreeformElement}>=[];
  for(const r of rects){
    const t=texts.find(x=>x.slot==="ctaLabel" || x.role==="cta" || contains(r,x,Math.max(3,r.h*.15)));
    if(!t) continue;
    const icon=elements.find(e=>e.id!==r.id && e.id!==t.id && (e.slot==="ctaIcon" || ((overlaps(r,e)>0 || contains(r,e,Math.max(3,r.h*.12))) && e.w<=r.h*1.5 && e.h<=r.h*1.5)));
    out.push({rect:r,text:t,...(icon?{icon}:{})});
  }
  return out;
}

export function buildDesignModelV3(master:FreeformConfig,w:number,h:number):DesignModelV3 {
  const els=master.elements;
  const used=new Set<string>();
  const assemblies:DesignAssemblyV3[]=[];
  const add=(id:string,kind:AssemblyKind,behaviour:AssemblyBehaviour,members:FreeformElement[],parentId?:string,lock=true)=>{
    const uniq=members.filter((e,i,a)=>a.findIndex(x=>x.id===e.id)===i);
    if(!uniq.length) return;
    uniq.forEach(e=>used.add(e.id));
    assemblies.push({id,kind,behaviour,members:uniq.map(member),bounds:box(uniq),lockInternalGeometry:lock,...(parentId?{parentId}:{})});
  };

  // Explicit InDesign layoutBlock wins. It is the strongest available signal.
  const blocks=new Map<string,FreeformElement[]>();
  for(const e of els) if(e.layoutBlock) blocks.set(e.layoutBlock,[...(blocks.get(e.layoutBlock)??[]),e]);
  for(const [id,m] of blocks){
    const slots=new Set(m.map(e=>e.slot));
    const kind:AssemblyKind=slots.has("cta")||slots.has("ctaLabel")||slots.has("ctaIcon")?"cta":slots.has("logo")||slots.has("lockup")?"brand":slots.has("photo")||slots.has("cutout")?"hero":m.some(e=>e.type==="text")?"copy":"other";
    add(`block:${id}`,kind,kind==="hero"?"locked-shape":"connected",m,undefined,kind!=="copy");
  }

  // A pill + its copy + its icon is inseparable, even when the source file
  // forgot to group them. This is intentionally inside-out grouping.
  let ctaN=0;
  for(const p of pillCandidates(els)){
    const m=[p.rect,p.text,...(p.icon?[p.icon]:[])];
    if(m.every(e=>used.has(e.id))) continue;
    add(`cta:${ctaN++}`,"cta","connected",m,"copy-stack",true);
  }

  // Hero: shaped/cutout image plus overlapping outline/decorative geometry.
  const hero=els.find((e):e is FreeformImage=>e.type==="image" && (e.shape || e.slot==="photo" || e.slot==="cutout") && e.role!=="logo");
  if(hero && !used.has(hero.id)){
    const companions=els.filter(e=>e.id!==hero.id && !used.has(e.id) && (e.slot==="cutout" || (overlaps(hero,e)>0 && (e.type==="rect" || e.slot==="other"))));
    add("hero","hero","locked-shape",[hero,...companions],undefined,true);
  }

  // Brand furniture: logo/lockup plus touching pattern/band decoration.
  const logos=els.filter(e=>!used.has(e.id) && (e.slot==="logo"||e.slot==="lockup"||(e.type==="image"&&e.role==="logo")));
  if(logos.length){
    const lb=box(logos);
    const near=els.filter(e=>!used.has(e.id)&&!logos.some(l=>l.id===e.id)&&(e.slot==="band"||e.slot==="other"||e.type==="rect") && Math.abs(cx(e)-cx(lb)) < w*.7 && Math.abs(cy(e)-cy(lb)) < h*.25);
    add("brand","brand","connected",[...near,...logos],undefined,false);
  }

  // Remaining live copy becomes a responsive stack. CTA children remain
  // nested under it but are not reclassified as independent text boxes.
  const copy=els.filter(e=>!used.has(e.id)&&e.type==="text"&&e.text.trim().length>0);
  if(copy.length) add("copy-stack","copy","stack",copy,undefined,false);

  // Keep any unclassified source element addressable without pretending it
  // has a relationship we did not observe.
  for(const e of els) if(!used.has(e.id)) add(`element:${e.id}`,e.type==="image"&&e.role==="decoration"?"decoration":"other","flex",[e],undefined,false);

  const relations:DesignRelationV3[]=[];
  const text=els.filter((e):e is FreeformText=>e.type==="text"&&e.text.trim().length>0);
  const tolX=Math.max(2,w*.012), tolY=Math.max(2,h*.012);
  for(let i=0;i<text.length;i++) for(let j=i+1;j<text.length;j++){
    const a=text[i],b=text[j];
    if(Math.abs(cx(a)-cx(b))<=tolX) relations.push({a:a.id,b:b.id,kind:"center-x",tolerance:tolX});
    if(Math.abs(cy(a)-cy(b))<=tolY) relations.push({a:a.id,b:b.id,kind:"center-y",tolerance:tolY});
  }
  const visible=els.filter(e=>!(e.w>=w*.95&&e.h>=h*.95));
  const minX=visible.length?Math.min(...visible.map(e=>Math.max(0,e.x))):0;
  const minR=visible.length?Math.min(...visible.map(e=>Math.max(0,w-(e.x+e.w)))):0;
  const minY=visible.length?Math.min(...visible.map(e=>Math.max(0,e.y))):0;
  const minB=visible.length?Math.min(...visible.map(e=>Math.max(0,h-(e.y+e.h)))):0;
  const safeX=Math.max(0,Math.min(minX,minR));
  const safeY=Math.max(0,Math.min(minY,minB));
  const primary=assemblies.filter(a=>["hero","copy","cta","brand"].includes(a.kind)).sort((a,b)=>a.bounds.x-b.bounds.x||a.bounds.y-b.bounds.y);
  return {version:3,source:{width:w,height:h},family:layoutFamilyV3(w,h),pattern:primary.map(a=>a.kind.toUpperCase()),assemblies,relations,safeMargin:{x:safeX/w,y:safeY/h}};
}

function transformAssembly(master:DesignAssemblyV3, out:Map<string,FreeformElement>) {
  const members=master.members.map(m=>out.get(m.id)).filter(Boolean) as FreeformElement[];
  if(!master.lockInternalGeometry || members.length<2) return;
  // Anchor the assembly to the generated position of its largest member, but
  // restore every child's master-relative offsets with ONE uniform scale.
  const anchorMaster=[...master.members].sort((a,b)=>b.w*b.h-a.w*a.h)[0];
  const anchorOut=out.get(anchorMaster.id); if(!anchorOut) return;
  const s=Math.min(anchorOut.w/Math.max(1,anchorMaster.w),anchorOut.h/Math.max(1,anchorMaster.h));
  const ox=anchorOut.x-(anchorMaster.x-master.bounds.x)*s;
  const oy=anchorOut.y-(anchorMaster.y-master.bounds.y)*s;
  for(const mm of master.members){
    const e=out.get(mm.id); if(!e) continue;
    e.x=Math.round(ox+(mm.x-master.bounds.x)*s);
    e.y=Math.round(oy+(mm.y-master.bounds.y)*s);
    e.w=Math.max(1,Math.round(mm.w*s)); e.h=Math.max(1,Math.round(mm.h*s));
    if(e.type==="text") e.fontSize=Math.max(6,Math.round(e.fontSize*s*100)/100);
  }
}

/** Apply master relationships after any existing compositor has proposed a
 * layout. This makes v3 compatible with today's import/render/export stack. */
export function enforceDesignModelV3(master:FreeformConfig, candidate:FreeformConfig,srcW:number,srcH:number,dstW:number,dstH:number):FreeformConfig {
  const model=buildDesignModelV3(master,srcW,srcH);
  const elements=candidate.elements.map(e=>({...e})) as FreeformElement[];
  const out=new Map(elements.map(e=>[e.id,e]));

  for(const a of model.assemblies) transformAssembly(a,out);

  // Master-observed centre lines are hard relationships. Move the smaller
  // semantic item, never deform it.
  for(const rel of model.relations){
    const a=out.get(rel.a), b=out.get(rel.b); if(!a||!b) continue;
    if(rel.kind==="center-x") b.x=Math.round(cx(a)-b.w/2);
    if(rel.kind==="center-y") b.y=Math.round(cy(a)-b.h/2);
  }

  // Preserve measured safe area for copy/CTA/brand unless the master itself
  // deliberately bled that member. Whole-canvas backgrounds are exempt.
  const mx=Math.round(model.safeMargin.x*dstW), my=Math.round(model.safeMargin.y*dstH);
  for(const e of elements){
    const isBg=e.w>=dstW*.95&&e.h>=dstH*.95;
    const asm=model.assemblies.find(a=>a.members.some(m=>m.id===e.id));
    if(isBg||asm?.kind==="hero") continue; // hero may intentionally bleed
    if(e.x>=0&&e.x<mx) e.x=mx;
    if(e.y>=0&&e.y<my) e.y=my;
    if(e.x+e.w<=dstW&&e.x+e.w>dstW-mx) e.x=Math.max(mx,dstW-mx-e.w);
    if(e.y+e.h<=dstH&&e.y+e.h>dstH-my) e.y=Math.max(my,dstH-my-e.h);
  }

  const notes=[...(candidate.adaptNotes??[])];
  notes.push(`Layout Engine v3: ${model.pattern.join(" → ") || "master structure"}; ${model.assemblies.filter(a=>a.lockInternalGeometry).length} connected/locked assemblies enforced.`);
  return {...candidate,elements,adaptMethod:`v3:${model.family}:${candidate.adaptMethod??"adapted"}`,adaptNotes:notes,designModelV3:model as any};
}

export function validateDesignModelV3(master:FreeformConfig,candidate:FreeformConfig,srcW:number,srcH:number,dstW:number,dstH:number):string[]{
  const model=buildDesignModelV3(master,srcW,srcH), out=new Map(candidate.elements.map(e=>[e.id,e]));
  const errors:string[]=[];
  for(const a of model.assemblies.filter(x=>x.lockInternalGeometry)){
    const ratios:number[]=[];
    for(const m of a.members){const e=out.get(m.id);if(!e){errors.push(`${a.kind}: missing ${m.id}`);continue;} ratios.push((e.w/Math.max(1,m.w))/(e.h/Math.max(1,m.h)));}
    if(ratios.some(r=>Math.abs(r-1)>.025)) errors.push(`${a.kind}: locked geometry changed shape`);
  }
  for(const r of model.relations){const a=out.get(r.a),b=out.get(r.b);if(!a||!b)continue;if(r.kind==="center-x"&&Math.abs(cx(a)-cx(b))>Math.max(2,dstW*.012))errors.push(`alignment: ${r.a} and ${r.b} lost shared centre line`);}
  return [...new Set(errors)];
}
