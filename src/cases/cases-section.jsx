import React,{useEffect,useRef,useState} from 'react';
import {sortIncidents} from '../lib/incident-order.js';

export function CasesSection(){
  const [order,setOrder]=useState('recent'),[feed,setFeed]=useState({cases:[],loading:true}),[reload,setReload]=useState(0);
  const generation=useRef(0);
  useEffect(()=>{
    generation.current++;
    let active=true;const controller=new AbortController();
    setFeed(old=>({...old,loading:true,loadingMore:false,error:null}));
    (async()=>{
      try{
        const response=await fetch('/api/cases?order='+order,{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.cases))throw Error();
        if(active)setFeed({...data,loading:false,cached:false});
      }catch{
        if(!active)return;
        try{
          const response=await fetch('/data/cases-snapshot.json',{signal:controller.signal});if(!response.ok)throw Error();
          const snapshot=await response.json();if(!Array.isArray(snapshot.cases))throw Error();
          if(active)setFeed({cases:sortIncidents(snapshot.cases,order),loading:false,cached:true,snapshotAt:snapshot.snapshotAt,nextOffset:null});
        }catch{if(active)setFeed({cases:[],loading:false,error:'Cases are temporarily unavailable.'});}
      }
    })();
    return()=>{active=false;controller.abort();};
  },[order,reload]);
  async function more(){
    const started=generation.current;
    setFeed(old=>({...old,loadingMore:true,error:null}));
    try{
      const response=await fetch('/api/cases?order='+order+'&offset='+feed.nextOffset,{cache:'no-store'});if(!response.ok)throw Error();
      const data=await response.json();if(!Array.isArray(data.cases))throw Error();
      if(started!==generation.current)return;
      if(data.revision!==feed.revision){setReload(x=>x+1);return;}
      setFeed(old=>({...old,cases:[...old.cases,...data.cases],nextOffset:data.nextOffset,loadingMore:false}));
    }catch{if(started===generation.current)setFeed(old=>({...old,loadingMore:false,error:'More cases could not be loaded. Please retry.'}));}
  }
  return <section className="section stories" id="stories"><div className="shell">
    <div className="section-kicker">The evidence</div>
    <div className="split-heading"><h2>Real projects.<br/>Real consequences.</h2><p>Account lockouts, interrupted businesses, and difficult recoveries. Read the public reports and Supabase’s own incident records.</p></div>
    <div className="story-controls"><p>{order==='recent'?'Newest report first; higher impact breaks ties on the same date.':'Newest year first; higher impact first within each year.'} Dates refer to the original report or official incident.</p><label>Sort cases <select value={order} onChange={e=>setOrder(e.target.value)}><option value="recent">Newest first</option><option value="impact">Impact within each year</option></select></label></div>
    {feed.loading&&<p role="status">Loading published cases…</p>}
    {feed.cached&&<p className="source-note" role="status">The live case feed is unavailable. Showing the published site snapshot from {feed.snapshotAt}. <button type="button" onClick={()=>setReload(x=>x+1)}>Retry live feed</button></p>}
    {feed.error&&<p role="alert">{feed.error} <button type="button" onClick={()=>setReload(x=>x+1)}>Retry</button></p>}
    {!feed.loading&&!feed.error&&!feed.cases.length&&<p>No cases are currently published.</p>}
    <div className="story-list" role="list">{feed.cases.map((story,index)=><article className="story-row" role="listitem" key={story.id}><details open={index===0}><summary><span className="story-row-tag">{story.tag}</span><span className="story-row-title">{story.title}</span></summary><p>{story.body}</p><small>{story.verified}</small></details><a className="story-row-source" href={story.href} target="_blank" rel="noreferrer">{story.source} <span aria-hidden="true">↗</span></a></article>)}</div>
    {feed.nextOffset!=null&&<p><button className="button button-ghost" type="button" disabled={feed.loadingMore} onClick={more}>{feed.loadingMore?'Loading…':'Load more reports'}</button></p>}
    <p className="source-note">No policies, feature requests, hypotheticals or backup-market discussions are counted. Community reports document what the poster reported; official incidents document what Supabase confirmed. A report is not presented as independent proof of cause. Discord links may require sign-in and access to the Supabase server.</p>
    <p className="source-note"><a href="/cases/submit">Partner submissions</a> · New submissions are reviewed before publication.</p>
  </div></section>;
}
