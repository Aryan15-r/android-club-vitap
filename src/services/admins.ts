import type{AdminInvite,AdminMember}from'../types'
import{emitChange,fail,failAuth,requireSupabase}from'./client'

export type InviteStatus='added'|'pending'|'exists'|'self'
export interface InviteResult{status:InviteStatus;email?:string}

// The admins table is only readable through these RPCs, so no email addresses
// or allowlist rows are exposed to the public REST surface.
export const adminService={
 async listAdmins():Promise<AdminMember[]>{
  const{data,error}=await requireSupabase().rpc('list_admins')
  if(error)fail(error)
  return ((data??[]) as any[]).map(r=>({
   id:r.user_id as string,
   email:(r.email as string)||'',
   createdAt:r.created_at as string,
   isSelf:!!r.is_self
  }))
 },

 async listInvites():Promise<AdminInvite[]>{
  const{data,error}=await requireSupabase().rpc('list_admin_invites')
  if(error)fail(error)
  return ((data??[]) as any[]).map(r=>({
   email:r.email as string,
   createdAt:r.created_at as string,
   invitedBy:(r.invited_by as string)||''
  }))
 },

 async invite(email:string):Promise<InviteResult>{
  const{data,error}=await requireSupabase().rpc('invite_admin',{p_email:email.trim()})
  if(error)fail(error)
  emitChange()
  return data as InviteResult
 },

 async remove(userId:string):Promise<void>{
  const{error}=await requireSupabase().rpc('remove_admin',{p_user_id:userId})
  if(error)fail(error)
  emitChange()
 },

 async cancelInvite(email:string):Promise<void>{
  const{error}=await requireSupabase().rpc('cancel_admin_invite',{p_email:email})
  if(error)fail(error)
  emitChange()
 },

 // Sends a Supabase magic link. The link signs the person in and the client
 // applies the pending invitation during initAuth, so no service-role key or
 // extra server is needed. `createUser` is true for a brand-new email.
 async sendInviteEmail(email:string,createUser:boolean):Promise<void>{
  const{error}=await requireSupabase().auth.signInWithOtp({
   email:email.trim(),
   options:{
    shouldCreateUser:createUser,
    emailRedirectTo:`${window.location.origin}/admin`
   }
  })
  if(error)failAuth(error.message)
 }
}
