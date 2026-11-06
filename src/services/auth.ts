import type{AdminUser}from'../types'
import{getSupabase,failAuth,requireSupabase}from'./client'

const UNLOCK_KEY='acvit_unlock'
// The hidden entrance is a user-experience gate, not a security boundary. Real
// access control is Supabase Auth plus row level security. The value lives in a
// VITE_ variable, so treat it as public and change it in .env.local.
const ACCESS_KEY=(import.meta.env.VITE_ADMIN_ACCESS_KEY as string|undefined)||'admin@17'

interface AuthUserLike{id:string;email?:string;user_metadata?:Record<string,unknown>}
export interface AuthSnapshot{user:AdminUser|null;unlocked:boolean;ready:boolean}

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
  const admin=data.session?await resolveAdmin(data.session.user):null
  publish({user:admin,unlocked:readUnlocked(),ready:true})
 }catch{
  publish({user:null,unlocked:readUnlocked(),ready:true})
 }
 // Keep the cached admin in sync with token refreshes and sign-outs. Queries
 // are deferred so they never run inside the auth client's lock.
 sb.auth.onAuthStateChange((_event,session)=>{
  setTimeout(()=>{
   if(!session){publish({user:null,ready:true});return}
   resolveAdmin(session.user)
    .then(user=>publish({user,ready:true}))
    .catch(()=>publish({user:null,ready:true}))
  },0)
 })
}

export const authService={
 async login(c:{email:string;password:string}):Promise<AdminUser>{
  const sb=requireSupabase()
  const{data,error}=await sb.auth.signInWithPassword({email:c.email.trim(),password:c.password})
  if(error)failAuth(error.message)
  if(!data.session||!data.user)throw new Error('Sign in failed. Please try again.')
  const admin=await resolveAdmin(data.user)
  if(!admin){
   await sb.auth.signOut()
   throw new Error('This account does not have admin access.')
  }
  publish({user:admin,ready:true})
  return admin
 },

 async logout():Promise<void>{
  const sb=getSupabase()
  if(sb)await sb.auth.signOut().catch(()=>{})
  try{sessionStorage.removeItem(UNLOCK_KEY)}catch{}
  publish({user:null,unlocked:false,ready:true})
 },

 // Synchronous on purpose: the existing hidden entrance calls this while
 // typing, so it must answer immediately.
 verifyAccessKey(k:string):boolean{
  const ok=k.length>0&&k===ACCESS_KEY
  if(ok){
   try{sessionStorage.setItem(UNLOCK_KEY,'1')}catch{}
   publish({unlocked:true})
  }
  return ok
 },

 isUnlocked():boolean{
  return readUnlocked()
 },

 getCurrentAdmin():AdminUser|null{
  return snapshot.user
 }
}
