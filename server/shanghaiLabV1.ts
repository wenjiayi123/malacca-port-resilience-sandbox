/** Isolated Shanghai scheduling adapter. Never mutates the existing sandbox or models. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

export type Job = { id: string; arrival_hour: number; duration_hours: number; deadline_hour: number; cranes: number; shore_kw: number; priority: number; teu: number };
export type Trial = { schema: string; trial_id: string; port_id: string; snapshot_sha256: string; quality: string; production_authority: boolean; jobs: Job[]; resources: { berths: number; cranes: number; pilots: number; tugs: number; channel_concurrency: number; berth_capacity: number[]; channel_open: boolean[] }; energy: { base_kw: number[]; pv_kw: number[]; grid_limit_kw: number[]; crane_kw: number; price_cny_kwh: number[] } };
export type Assignment = { job_id: string; start_hour: number; end_hour: number; berth: number };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const json = (res: ServerResponse, body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };

export function readTrial(payload: Record<string, unknown>): Trial {
  if (typeof payload.snapshot_json !== 'string' || Buffer.byteLength(payload.snapshot_json) > 200000 || hash(payload.snapshot_json) !== payload.snapshot_transport_sha256) throw Error('snapshot transport mismatch');
  const c = JSON.parse(payload.snapshot_json) as Trial;
  if (c.schema !== 'shanghai-unified-trial.v1' || c.port_id !== 'CNSHA' || c.production_authority !== false || c.quality !== 'valid_for_engineering_trial') throw Error('Shanghai identity, authority or quality rejected');
  if (!Array.isArray(c.jobs) || c.jobs.length < 1 || c.jobs.length > 30 || new Set(c.jobs.map(j => j.id)).size !== c.jobs.length) throw Error('invalid jobs');
  if (![c.resources.berths, c.resources.cranes, c.resources.pilots, c.resources.tugs, c.resources.channel_concurrency].every(n => Number.isInteger(n) && n > 0 && n <= 100)) throw Error('invalid resource capacity');
  for (const values of [c.resources.berth_capacity, c.resources.channel_open, c.energy.base_kw, c.energy.pv_kw, c.energy.grid_limit_kw, c.energy.price_cny_kwh]) if (!Array.isArray(values) || values.length !== 24) throw Error('incomplete horizon');
  for (const values of [c.energy.base_kw, c.energy.pv_kw, c.energy.grid_limit_kw, c.energy.price_cny_kwh]) if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw Error('invalid energy inputs');
  if (!c.resources.berth_capacity.every(v => Number.isInteger(v) && v >= 0 && v <= c.resources.berths) || !c.resources.channel_open.every(v => typeof v === 'boolean') || !Number.isFinite(c.energy.crane_kw) || c.energy.crane_kw < 0) throw Error('invalid availability or equipment power');
  for (const j of c.jobs) if (![j.arrival_hour, j.duration_hours, j.deadline_hour, j.cranes, j.shore_kw, j.priority, j.teu].every(v => Number.isInteger(v) && v >= 0) || j.priority < 1 || j.teu < 1 || j.arrival_hour >= j.deadline_hour) throw Error('invalid job quantities');
  for (const j of c.jobs) if (!j.id.startsWith('SIM-CNSHA-') || ![j.arrival_hour, j.duration_hours, j.deadline_hour, j.cranes, j.shore_kw, j.priority].every(Number.isFinite) || !Number.isInteger(j.arrival_hour) || !Number.isInteger(j.duration_hours) || j.arrival_hour < 0 || j.duration_hours < 1 || j.duration_hours > 8 || j.deadline_hour > 24 || j.cranes < 1) throw Error('invalid job contract');
  return c;
}

export function planTrial(c: Trial) {
  const candidates = ['fcfs', 'earliest-deadline', 'shortest-service'].map(method => {
    const order = [...c.jobs].sort((a,b) => (method === 'earliest-deadline' ? a.deadline_hour-b.deadline_hour : method === 'shortest-service' ? a.duration_hours-b.duration_hours : a.arrival_hour-b.arrival_hour) || a.id.localeCompare(b.id));
    const occupied = Array.from({length:c.resources.berths}, () => Array<number>(24).fill(0));
    const cranes = Array<number>(24).fill(0), starts = Array<number>(24).fill(0), shore = Array<number>(24).fill(0);
    const scheduled: Assignment[] = [];
    for (const j of order) {
      let chosen: Assignment | null = null;
      for (let s=j.arrival_hour; s+j.duration_hours<=24 && !chosen; s++) {
        if (!c.resources.channel_open[s] || starts[s]>=Math.min(c.resources.channel_concurrency,c.resources.pilots,Math.floor(c.resources.tugs/2))) continue;
        for (let b=0;b<c.resources.berths && !chosen;b++) {
          let ok=true;
          for(let h=s;h<s+j.duration_hours;h++) if (occupied[b][h] || b>=c.resources.berth_capacity[h] || cranes[h]+j.cranes>c.resources.cranes || c.energy.base_kw[h]+shore[h]+j.shore_kw+(cranes[h]+j.cranes)*c.energy.crane_kw-c.energy.pv_kw[h]>c.energy.grid_limit_kw[h]) { ok=false; break; }
          if(ok) chosen={job_id:j.id,start_hour:s,end_hour:s+j.duration_hours,berth:b};
        }
      }
      if (!chosen) return {method,feasible:false,scheduled:[],reason:`No complete feasible plan for ${j.id}`};
      scheduled.push(chosen);starts[chosen.start_hour]++;
      for(let h=chosen.start_hour;h<chosen.end_hour;h++){occupied[chosen.berth][h]++;cranes[h]+=j.cranes;shore[h]+=j.shore_kw;}
    }
    const wait=scheduled.reduce((v,r)=>v+r.start_hour-c.jobs.find(j=>j.id===r.job_id)!.arrival_hour,0);
    const late=scheduled.reduce((v,r)=>v+Math.max(0,r.end_hour-c.jobs.find(j=>j.id===r.job_id)!.deadline_hour),0);
    return {method,feasible:true,scheduled,metrics:{wait_vessel_hours:wait,late_vessel_hours:late,processed_teu:c.jobs.reduce((n,j)=>n+j.teu,0)}};
  });
  const feasible = candidates.filter(x => x.feasible).sort((a,b)=>(a.metrics!.late_vessel_hours-b.metrics!.late_vessel_hours)||(a.metrics!.wait_vessel_hours-b.metrics!.wait_vessel_hours));
  if(!feasible.length) throw Error('No complete feasible schedule; trial blocked');
  return {schema:'shanghai-plan.v1',source_snapshot_sha256:c.snapshot_sha256,trial_id:c.trial_id,port_id:c.port_id,...feasible[0],candidates,production_authority:false,evidence_class:'simulation_output',optimality:'Three bounded heuristics; no global optimum claim'};
}

export function reviewExternalPlan(c:Trial,payload:Record<string,unknown>){
  if(typeof payload.plan_json!=='string'||hash(payload.plan_json)!==payload.plan_transport_sha256)throw Error('plan transport mismatch');
  const p=JSON.parse(payload.plan_json) as {scheduled:Assignment[];source_snapshot_sha256:string;production_authority:boolean};
  if(p.source_snapshot_sha256!==c.snapshot_sha256||p.production_authority!==false||!Array.isArray(p.scheduled)||p.scheduled.length!==c.jobs.length)throw Error('incomplete plan or wrong snapshot');
  if(new Set(p.scheduled.map(r=>r.job_id)).size!==c.jobs.length)throw Error('duplicate jobs');
  for(const r of p.scheduled){const j=c.jobs.find(x=>x.id===r.job_id);if(!j||![r.start_hour,r.end_hour,r.berth].every(Number.isInteger)||r.start_hour<j.arrival_hour||r.end_hour-r.start_hour!==j.duration_hours||r.end_hour>24||r.berth<0||r.berth>=c.resources.berths)throw Error('invalid assignment');}
  for(let h=0;h<24;h++){
    const active=p.scheduled.filter(r=>r.start_hour<=h&&h<r.end_hour),starts=p.scheduled.filter(r=>r.start_hour===h);
    if(new Set(active.map(r=>r.berth)).size!==active.length||active.some(r=>r.berth>=c.resources.berth_capacity[h]))throw Error('berth conflict');
    if(starts.length>Math.min(c.resources.channel_concurrency,c.resources.pilots,Math.floor(c.resources.tugs/2))||(!c.resources.channel_open[h]&&starts.length))throw Error('channel/pilot/tug conflict');
    const jobs=active.map(r=>c.jobs.find(j=>j.id===r.job_id)!);
    const cranes=jobs.reduce((n,j)=>n+j.cranes,0),power=jobs.reduce((n,j)=>n+j.shore_kw+j.cranes*c.energy.crane_kw,0);
    if(cranes>c.resources.cranes||c.energy.base_kw[h]+power-c.energy.pv_kw[h]>c.energy.grid_limit_kw[h]+1e-6)throw Error('crane or power conflict');
  }
  return {schema:'shanghai-native-plan-review.v1',system:'malacca-sandbox',source_snapshot_sha256:c.snapshot_sha256,plan_transport_sha256:payload.plan_transport_sha256,reviewed:true,job_count:p.scheduled.length,production_authority:false};
}

export function createShanghaiLabMiddleware() {
  const {token}=validateRuntimeSecurityConfiguration(process.env.HOST || '127.0.0.1',process.env.PORT_API_TOKEN);
  return async(req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    const url=new URL(req.url || '/', 'http://127.0.0.1');
    if(!url.pathname.startsWith('/api/shanghai-lab/v1/')){next();return;}
    if(token){const supplied=String(req.headers.authorization || '').replace(/^Bearer /,'');const a=Buffer.from(token),b=Buffer.from(supplied);if(a.length!==b.length||!timingSafeEqual(a,b)){json(res,{error:'authentication required'},401);return;}}
    if(url.pathname.endsWith('/health')&&req.method==='GET'){json(res,{schema:'shanghai-adapter.v1',system:'malacca-sandbox',production_authority:false});return;}
    if((url.pathname.endsWith('/plan')||url.pathname.endsWith('/review'))&&req.method==='POST'){
      try{const chunks:Uint8Array[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>512000)throw Error('body too large');chunks.push(chunk);}const payload=JSON.parse(Buffer.concat(chunks).toString());const trial=readTrial(payload);json(res,url.pathname.endsWith('/review')?reviewExternalPlan(trial,payload):planTrial(trial));}
      catch(e){json(res,{error:e instanceof Error?e.message:'invalid request',production_authority:false},422);}return;
    }
    json(res,{error:'unknown Shanghai trial route'},404);
  };
}

export function shanghaiLabPlugin():Plugin {return {name:'shanghai-lab-v1',configureServer(server){server.middlewares.use(createShanghaiLabMiddleware());},configurePreviewServer(server){server.middlewares.use(createShanghaiLabMiddleware());}};}
