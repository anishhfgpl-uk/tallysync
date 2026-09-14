import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Computer = { id: string; name: string; host: string; port: number; status: 'unknown'|'connected'|'offline'; lastChecked?: string };
const KEY='tallysync_remote_computers';
const load=():Computer[]=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};

function App(){
 const [computers,setComputers]=useState<Computer[]>(load);
 const [name,setName]=useState(''); const [host,setHost]=useState(''); const [port,setPort]=useState('9000');
 const [selected,setSelected]=useState<string>(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(computers)),[computers]);
 const test=async(c:Computer)=>{
   setBusy(true); setMessage(`Connecting to ${c.host}:${c.port}...`);
   try{
    const r=await fetch('/api/company/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:`http://${c.host}`,port:c.port})});
    const d=await r.json(); if(!r.ok||!d.success) throw new Error(d.error||'Connection failed');
    setComputers(x=>x.map(v=>v.id===c.id?{...v,status:d.company?.status==='connected'?'connected':'offline',lastChecked:new Date().toISOString()}:v));
    setMessage(d.message||'Tally connection successful.');
   }catch(e:any){setComputers(x=>x.map(v=>v.id===c.id?{...v,status:'offline',lastChecked:new Date().toISOString()}:v));setMessage(e.message||'Unable to connect.');}
   finally{setBusy(false)}
 };
 const add=()=>{if(!name.trim()||!host.trim())return setMessage('Computer name and IP/hostname are required.'); const c={id:crypto.randomUUID(),name:name.trim(),host:host.trim(),port:Number(port)||9000,status:'unknown' as const};setComputers(x=>[...x,c]);setName('');setHost('');setPort('9000');setSelected(c.id);setMessage('Computer saved. Click Test Connection.');};
 const remove=(id:string)=>{setComputers(x=>x.filter(c=>c.id!==id));if(selected===id)setSelected('');};
 const current=computers.find(c=>c.id===selected);
 return <div className="shell">
  <header><div><div className="eyebrow">ANISHTECH • TALLYSYNC</div><h1>Remote Tally Computers</h1><p>Add a TallyPrime computer once, then reconnect whenever you need to fetch or sync data.</p></div><div className="badge">Port 9000</div></header>
  <main>
   <section className="card form"><h2>Add Tally Computer</h2><div className="grid"><label>Computer Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Office Tally"/></label><label>IP Address / Hostname<input value={host} onChange={e=>setHost(e.target.value)} placeholder="192.168.1.25"/></label><label>Port<input value={port} onChange={e=>setPort(e.target.value)} inputMode="numeric"/></label><button onClick={add}>＋ Save Computer</button></div><small>Same LAN/VPN: use the local IP. For another location, the Tally PC must be reachable through a secure VPN/bridge; do not expose port 9000 directly to the public Internet.</small></section>
   <section className="card"><div className="sectionHead"><div><h2>Saved Computers</h2><span>{computers.length} configured</span></div>{message&&<div className="message">{message}</div>}</div>
    {computers.length===0?<div className="empty">No Tally computer added yet.</div>:<div className="list">{computers.map(c=><div className={`row ${selected===c.id?'selected':''}`} key={c.id} onClick={()=>setSelected(c.id)}><div className="dotWrap"><i className={`dot ${c.status}`}/></div><div className="grow"><b>{c.name}</b><span>{c.host}:{c.port}</span></div><span className={`status ${c.status}`}>{c.status}</span><button className="secondary" disabled={busy} onClick={e=>{e.stopPropagation();test(c)}}>Test</button><button className="danger" onClick={e=>{e.stopPropagation();remove(c.id)}}>Delete</button></div>)}</div>}
   </section>
   {current&&<section className="card action"><div><div className="eyebrow">SELECTED COMPUTER</div><h2>{current.name}</h2><p>{current.host}:{current.port} • {current.status}</p></div><div className="actions"><button disabled={busy} onClick={()=>test(current)}>{busy?'Connecting…':'Connect / Fetch Company'}</button><button className="secondary" disabled={busy} onClick={async()=>{setMessage('Fetching company, debtor and stock data…');try{await Promise.all(['/api/company','/api/debtors','/api/items'].map(u=>fetch(u)));setMessage('Remote connection is active. Data endpoints responded.')}catch(e:any){setMessage(e.message||'Fetch failed.')}}}>Fetch Data</button></div></section>}
  </main>
  <footer>Remote Tally connection is isolated to this TallySync feature branch. Existing main branch is untouched.</footer>
 </div>
}
createRoot(document.getElementById('root')!).render(<App/>);
