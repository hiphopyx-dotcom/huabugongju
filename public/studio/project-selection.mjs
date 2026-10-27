// Capture the old shared pointer before the initial guest project can change it.
// Every candidate is resolved only against the already-open account's projects.
export function createProjectSelection(storage){
 const legacyId=storage.getItem('jbp-active');
 const key=scope=>{if(typeof scope!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(scope))throw Error('账户标识无效');return 'jbp-active:'+scope;};
 return {
  choose(projects,{scope,requestedId}={}){
   for(const id of [requestedId,storage.getItem(key(scope)),legacyId]){
    const project=id&&projects.find(project=>project.id===id);if(project)return project;
   }
   return projects[0];
  },
  remember(scope,id){storage.setItem(key(scope),id);},
 };
}
