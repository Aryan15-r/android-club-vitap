// The single module components import services from. Every export here is the
// same API the prototype exposed, now backed by Supabase Postgres, Auth and
// Storage instead of in-memory objects.
export{onChange}from'./client'
export{initAuth,getAuthSnapshot,onAuthChange,authService}from'./auth'
export{clubService}from'./settings'
export{eventService}from'./events'
export{teamService}from'./team'
export{announcementService}from'./announcements'
export{mediaService}from'./media'
export{adminService}from'./admins'
