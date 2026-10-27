import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSelection} from '../public/studio/project-selection.mjs';

function storage(entries=[]){const values=new Map(entries);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
const a={id:'project-a'},b={id:'project-b'},guest={id:'guest-project'};

test('guest startup cannot overwrite the legacy account selection during first upgrade',()=>{
 const local=storage([['jbp-active',b.id]]),selection=createProjectSelection(local);
 assert.equal(selection.choose([guest],{scope:'guest'}),guest);
 selection.remember('guest',guest.id);
 assert.equal(selection.choose([a,b],{scope:'account-a'}),b);
 selection.remember('account-a',b.id);
 const refreshed=createProjectSelection(local);
 assert.equal(refreshed.choose([a,b],{scope:'account-a'}),b);
 assert.equal(local.getItem('jbp-active'),b.id);
});

test('each account and guest retain independent pointers across reloads',()=>{
 const local=storage(),selection=createProjectSelection(local);
 selection.remember('account-a',b.id);selection.remember('account-b',a.id);selection.remember('guest',guest.id);
 const refreshed=createProjectSelection(local);
 assert.equal(refreshed.choose([a,b],{scope:'account-a'}),b);
 assert.equal(refreshed.choose([a,b],{scope:'account-b'}),a);
 assert.equal(refreshed.choose([guest],{scope:'guest'}),guest);
});

test('URL selection must belong to the opened account and invalid URLs preserve its saved project',()=>{
 const local=storage([['jbp-active:account-a',b.id],['jbp-active','other-account-project']]);
 const selection=createProjectSelection(local);
 assert.equal(selection.choose([a,b],{scope:'account-a',requestedId:a.id}),a);
 for(const requestedId of ['other-account-project','missing','../../private'])
  assert.equal(selection.choose([a,b],{scope:'account-a',requestedId}),b);
 assert.equal(selection.choose([guest],{scope:'guest',requestedId:b.id}),guest);
 assert.equal(selection.choose([],{scope:'account-a',requestedId:b.id}),undefined);
});

test('deleted or unavailable saved projects fall back only within the current account',()=>{
 const local=storage([['jbp-active:account-a','deleted'],['jbp-active','foreign']]);
 assert.equal(createProjectSelection(local).choose([a,b],{scope:'account-a'}),a);
 assert.throws(()=>createProjectSelection(local).remember('../account',a.id),/账户标识无效/);
});
