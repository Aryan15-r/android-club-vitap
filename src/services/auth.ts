import type{AdminUser}from'../types'
import{getSupabase,fail,failAuth,requireSupabase}from'./client'

const UNLOCK_KEY='acvit_unlock'
// The hidden entrance is a user-experience gate, not a security boundary. Real
// access control is Supabase Auth plus row level security. The value lives in a
// VITE_ variable, so treat it as public and change it in .env.local.
const ACCESS_KEY=(import.meta.env.VITE_ADMIN_ACCESS_KEY as string|undefined)||'admin@17'

interface AuthUserLike{id:string;email?:string;user_metadata?:Record<string,unknown>}
export interface AuthSnapshot{user:AdminUser|null;unlocked:boolean;ready:boolean}
export type LoginOutcome={status:'admin'}|{status:'setup';email:string}

const readUnlocked=()=>{
 try{return sessionStorage.getItem(UNLOCK_KEY)==='1'}catch{return false}
}

let snapshot:AuthSnapshot={user:null,unlocked:readUnlocked(),ready:false}
const subs=new Set<()=>void>()

export const getAuthSnapshot=()=>snapshot
export const onAuthChange=(f:()=>void)=>{subs.add(f);return()=>{subs.delete(f)}}

function publish(next:Partial<AuthSnapshot>){
 const merged={...snapshot,...next}
 if(
  merged.user?.id===snapshot.user?.id&&
  merged.user?.email===snapshot.user?.email&&
  merged.unlocked===snapshot.unlocked&&
  merged.ready===snapshot.ready
 )return
 snapshot=merged
 subs.forEach(f=>f())
}

const toAdmin=(user:AuthUserLike):AdminUser=>{
 const meta=user.user_metadata??{}
 const name=[meta.name,meta.full_name].find(v=>typeof v==='string'&&v.trim()) as string|undefined
 return{id:user.id,email:user.email??'',name:name?.trim()||user.email?.split('@')[0]||'Admin'}
}

// The admins table only exposes the signed-in user's own row, so this is a
// safe, cheap authorisation check. RLS still protects every table if it fails.
async function resolveAdmin(user:AuthUserLike):Promise<AdminUser|null>{
 const sb=getSupabase()
 if(!sb)return null
 const{data,error}=await sb.from('admins').select('user_id').eq('user_id',user.id).maybeSingle()
 if(error||!data)return null
 return toAdmin(user)
}

// Only true while the allowlist is empty. The RPC returns a boolean, never
// directory data, so it is safe to call before the first admin exists.
async function canSetup():Promise<boolean>{
 const sb=getSupabase()
 if(!sb)return false
 const{data,error}=await sb.rpc('admin_setup_available')
 return !error&&data===true
}

// Applies an invitation for the signed-in email. Safe to call for every
// account: it returns false when no invitation matches.
async function acceptInvite():Promise<boolean>{
 const sb=getSupabase()
 if(!sb)return false
 const{data,error}=await sb.rpc('accept_admin_invite')
 return !error&&data===true
}

// Resolve the admin row, accepting a pending invitation on the way. This keeps
// the normal admin path to a single query while making invitations automatic.
async function resolveWithInvite(user:AuthUserLike):Promise<AdminUser|null>{
 const admin=await resolveAdmin(user)
 if(admin)return admin
 if(!(await acceptInvite()))return null
 return resolveAdmin(user)
}

let initialized=false
export async function initAuth():Promise<void>{
 if(initialized)return
 initialized=true
 const sb=getSupabase()
 if(!sb){
  publish({user:null,unlocked:readUnlocked(),ready:true})
  return
 }
 try{
  const{data}=await sb.auth.getSession()
  const admin=data.session?await resolveWithInvite(data.session.user):null
  publish({user:admin,unlocked:readUnlocked(),ready:true})
 }catch{
  publish({user:null,unlocked:readUnlocked(),ready:true})
 }
 // Keep the cached admin in sync with token refreshes and sign-outs. Queries
 // are deferred so they never run inside the auth client's lock.
 sb.auth.onAuthStateChange((_event,session)=>{
  setTimeout(()=>{
   if(!session){publish({user:null,ready:true});return}
   resolveWithInvite(session.user)
    .then(user=>publish({user,ready:true}))
    .catch(()=>publish({user:null,ready:true}))
  },0)
 })
}

function markUnlocked(){
 try{sessionStorage.setItem(UNLOCK_KEY,'1')}catch{}
 publish({unlocked:true})
}

export const authService={
 async login(c:{email:string;password:string}):Promise<LoginOutcome>{
  const sb=requireSupabase()
  const{data,error}=await sb.auth.signInWithPassword({email:c.email.trim(),password:c.password})
  if(error)failAuth(error.message)
  if(!data.session||!data.user)throw new Error('Sign in failed. Please try again.')
  const admin=await resolveWithInvite(data.user)
  if(!admin){
   // On a brand-new database the first confirmed account may claim admin
   // instead of being turned away. Keep the session for that one action.
   if(await canSetup().catch(()=>false)){
    publish({user:null,ready:true})
    return{status:'setup',email:data.user.email||c.email.trim()}
   }
   await sb.auth.signOut()
   throw new Error('This account does not have admin access. Ask an admin to invite you.')
  }
  publish({user:admin,ready:true})
  return{status:'admin'}
 },

 // A restored session on a database with no admins can show the one-click
 // setup card without asking the person to type their password again.
 async setupSession():Promise<string|null>{
  const sb=getSupabase()
  if(!sb)return null
  const{data}=await sb.auth.getSession()
  if(!data.session)return null
  if(!(await canSetup().catch(()=>false)))return null
  return data.session.user.email||''
 },

 // Makes the current confirmed account the first admin. The RPC refuses when
 // an admin already exists, so this cannot be used to take over a configured
 // site; it is only a one-time bootstrap on a new database.
 async claimFirstAdmin():Promise<AdminUser>{
  const sb=requireSupabase()
  const{error}=await sb.rpc('claim_first_admin')
  if(error)fail(error)
  const{data:{user}}=await sb.auth.getUser()
  if(!user)throw new Error('Your session expired. Sign in again to finish setup.')
  const admin=await resolveAdmin(user)
  if(!admin)throw new Error('Could not enable admin access. Refresh and try again.')
  publish({user:admin,ready:true})
  return admin
 },

 async logout():Promise<void>{
  const sb=getSupabase()
  if(sb)await sb.auth.signOut().catch(()=>{})
  try{sessionStorage.removeItem(UNLOCK_KEY)}catch{}
  publish({user:null,unlocked:false,ready:true})
 },

 // Sends a Supabase recovery email. The link returns to this origin and opens
 // /admin/reset-password, where the user chooses a new password.
 async requestPasswordReset(email:string):Promise<void>{
  const sb=requireSupabase()
  const redirectTo=`${window.location.origin}/admin/reset-password`
  const{error}=await sb.auth.resetPasswordForEmail(email.trim(),{redirectTo})
  if(error)failAuth(error.message)
 },

 // A recovery link creates a session before the reset page renders.
 async hasSession():Promise<boolean>{
  const sb=getSupabase()
  if(!sb)return false
  const{data,error}=await sb.auth.getSession()
  return !error&&!!data.session
 },

 async completePasswordReset(password:string):Promise<void>{
  const sb=requireSupabase()
  const{error}=await sb.auth.updateUser({password})
  if(error)failAuth(error.message)
  await sb.auth.signOut()
  publish({user:null,ready:true})
 },

 // Synchronous on purpose: the existing hidden entrance calls this while
 // typing, so it must answer immediately.
 verifyAccessKey(k:string):boolean{
  const ok=k.length>0&&k===ACCESS_KEY
  if(ok)markUnlocked()
  return ok
 },

 isUnlocked():boolean{
  return readUnlocked()
 },

 getCurrentAdmin():AdminUser|null{
  return snapshot.user
 }
}
