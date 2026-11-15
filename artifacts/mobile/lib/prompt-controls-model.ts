import type {V2PromptPreferences,V2PromptPreferencesRequest,V2PromptQuestionType} from '@workspace/api-client-react';

export type PromptChoices=Pick<V2PromptPreferences,'invitationsEnabled'|'disabledTypes'>;
export const questionGroups:readonly {title:string;items:readonly (readonly [V2PromptQuestionType,string])[]}[]=[
 {title:'Routes',items:[['identify_service','Bus operator'],['clarify_time_basis','Departure time'],['operating_days','Operating days'],['pickup_place','Pickup location'],['complete_pattern','Stops']]},
 {title:'Fares',items:[['fare_paid','Fares paid'],['fare_advertised','Advertised fares']]},
 {title:'Updates',items:[['confirm_current_fact','Check older details'],['resolve_conflict_context','Clarify conflicting reports']]},
];
export const samePromptChoices=(a:PromptChoices,b:PromptChoices)=>a.invitationsEnabled===b.invitationsEnabled&&[...a.disabledTypes].sort().join('|')===[...b.disabledTypes].sort().join('|');
export type PromptSettingsState={phase:'loading'|'editing'|'saving'|'checking'|'unconfirmed'|'retry'|'conflict'|'error'|'auth'|'saved';base?:V2PromptPreferences;choice?:PromptChoices;pending?:V2PromptPreferencesRequest;message?:string};
type Port={read(signal:AbortSignal):Promise<V2PromptPreferences>;save(body:V2PromptPreferencesRequest,signal:AbortSignal):Promise<V2PromptPreferences>};

/** One account's volatile settings session. Never writes on load/reopen/check. */
export class PromptSettingsSession {
 state:PromptSettingsState={phase:'loading'};
 private controller?:AbortController;
 private disposed=false;
 constructor(private port:Port,private current:()=>boolean,private publish:(state:PromptSettingsState)=>void){}
 private active(){return !this.disposed&&this.current();}
 get busy(){return !!this.controller;}
 get dirty(){return !!this.state.base&&!!this.state.choice&&!samePromptChoices(this.state.base,this.state.choice);}
 private change(next:PromptSettingsState){if(this.active()){this.state=next;this.publish(next);}}
 dispose(){this.disposed=true;this.controller?.abort();}
 edit(choice:PromptChoices){if(!this.busy&&!this.state.pending&&this.state.base)this.change({...this.state,phase:'editing',choice:{invitationsEnabled:choice.invitationsEnabled,disabledTypes:[...choice.disabledTypes]},message:undefined});}
 async open(){if(this.state.pending)return this.check();if(this.dirty)return;return this.load();}
 async load(){
  if(!this.active()||this.busy)return;
  const controller=new AbortController();this.controller=controller;this.change({...this.state,phase:'loading',message:undefined});
  try{const base=await this.port.read(controller.signal);if(this.active())this.change({phase:'editing',base,choice:{invitationsEnabled:base.invitationsEnabled,disabledTypes:[...base.disabledTypes]}});}
  catch(error){if(this.active())this.change({...this.state,phase:(error as {status?:number}).status===401?'auth':'error',message:'Question settings could not load.'});}
  finally{if(this.controller===controller)this.controller=undefined;}
 }
 async save(){
  if(!this.active()||this.busy||!this.state.base||!this.state.choice)return;
  if(this.state.pending&&this.state.phase!=='retry')return;
  if(!this.state.pending&&!this.dirty)return;
  const pending=this.state.pending??{expectedRevision:this.state.base.revision,invitationsEnabled:this.state.choice.invitationsEnabled,disabledTypes:[...this.state.choice.disabledTypes].sort()};
  const controller=new AbortController();this.controller=controller;this.change({...this.state,phase:'saving',pending,message:undefined});
  try{const base=await this.port.save({...pending,disabledTypes:[...pending.disabledTypes]},controller.signal);if(this.active()){
   if(!samePromptChoices(base,pending))throw Error('SAVE_UNCONFIRMED');
   this.change({phase:'saved',base,choice:{invitationsEnabled:base.invitationsEnabled,disabledTypes:[...base.disabledTypes]},message:'Settings saved.'});
  }}catch(error){if(this.active()){const e=error as {status?:number;data?:{code?:string}};
   this.change({...this.state,phase:e.status===401||e.data?.code==='ACCOUNT_CHANGED'?'auth':'unconfirmed',message:e.status===409?'Your settings changed. Check the saved version before continuing.':'Saving could not be confirmed. Check your saved settings before trying again.'});
  }}finally{if(this.controller===controller)this.controller=undefined;}
 }
 async check(){
  if(!this.active()||this.busy||!this.state.pending||!this.state.base)return;
  const pending=this.state.pending,original=this.state.base,controller=new AbortController();this.controller=controller;this.change({...this.state,phase:'checking',message:undefined});
  try{const now=await this.port.read(controller.signal);if(!this.active())return;
   if(samePromptChoices(now,pending))this.change({phase:'saved',base:now,choice:{invitationsEnabled:now.invitationsEnabled,disabledTypes:[...now.disabledTypes]},message:'Settings saved.'});
   else if(now.revision===pending.expectedRevision&&samePromptChoices(now,original))this.change({...this.state,phase:'retry',message:'Your changes are not saved. You can try again.'});
   else this.change({...this.state,phase:'conflict',message:'Your settings changed on another device. Reload them before making more changes.'});
  }catch(error){if(this.active())this.change({...this.state,phase:(error as {status?:number}).status===401?'auth':'unconfirmed',message:'Saved settings could not be checked. Your choices are kept.'});}
  finally{if(this.controller===controller)this.controller=undefined;}
 }
}

/** Network throttle only. The server owns session expiry and invitation caps. */
export class ForegroundActivityGate {
 private actor:string|null=null;
 private foreground=false;
 private enabled=false;
 private lastAttempt=-Infinity;
 private pending?:AbortController;
 private epoch=0;
 context(actor:string|null,foreground:boolean,enabled:boolean){
  if(actor!==this.actor){this.epoch++;this.pending?.abort();this.pending=undefined;this.lastAttempt=-Infinity;}
  if(!foreground||!enabled){this.epoch++;this.pending?.abort();this.pending=undefined;}
  this.actor=actor;this.foreground=foreground;this.enabled=enabled;
 }
 async interact(now:number,send:(actor:string,signal:AbortSignal)=>Promise<unknown>){
  const elapsed=now-this.lastAttempt;
  if(!this.actor||!this.foreground||!this.enabled||this.pending||(elapsed>=0&&elapsed<60000))return false;
  const actor=this.actor,epoch=this.epoch,controller=new AbortController();this.pending=controller;this.lastAttempt=now;
  try{await send(actor,controller.signal);}catch{/* Optional activity never blocks capture. */}
  finally{if(epoch===this.epoch&&this.pending===controller)this.pending=undefined;}
  return true;
 }
 dispose(){this.epoch++;this.pending?.abort();this.pending=undefined;this.actor=null;this.enabled=false;}
}
