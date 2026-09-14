import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Computer = { id:string; name:string; host:string; port:number; status:'unknown'|'connected'|'offline'; lastChecked?:string };
const KEY = 'tallysync_remote_computers';
const menu = [
  ['dashboard','Dashboard'], ['company','Company'], ['debtors','Sundry Debtors'],
  ['items','Stock Items'], ['invoices','Invoices'], ['buffer','Buffer Queue'],
  ['gstr1','GSTR-1'], ['analytics','Analytics'], ['xml','XML Export'],
  ['remote','Remote Tally Computers']
];
const load = ():Computer[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

function App(){
  const [tab,setTab] = useState('dashboard');
  const [computers,setComputers] = useState<Computer[]>(load);
  const [name,setName] = useState('');
  const [host,setHost] = useState('');
  const [port,setPort] = useState('9000');
  const [selected,setSelected] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  useEffect(()=>localStorage.setItem(KEY,JSON.stringify(computers)),[computers]);

  const legacy = async (label:string,path:string) => {
    setBusy(true);
    try { const r=await fetch(path); if(!r.ok) throw new Error(`API ${r.status}`); await r.json(); setMessage(`${label} loaded successfully.`); }
    catch(e:any){ setMessage(`${label}: ${e.message}`); }
    finally { setBusy(false); }
  };
  const test = async (c:Computer) => {
    setBusy(true); setMessage(`Connecting to ${c.host}:${c.port}...`);
    try {
      const r=await fetch('/api/company/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:`http://${c.host}`,port:c.port})});
      const d=await r.json(); if(!r.ok || !d.success) throw new Error(d.error || 'Connection failed');
      setComputers(x=>x.map(v=>v.id===c.id?{...v,status:d.company?.status==='connected'?'connected':'offline',lastChecked:new Date().toISOString()}:v));
      setMessage(d.message || 'Tally connection successful.');
    } catch(e:any) {
      setComputers(x=>x.map(v=>v.id===c.id?{...v,status:'offline',lastChecked:new Date().toISOString()}:v));
      setMessage(e.message || 'Unable to connect.');
    } finally { setBusy(false); }
  };
  const add = () => {
    if(!name.trim() || !host.trim()) return setMessage('Computer name and IP/hostname are required.');
    const c:Computer={id:crypto.randomUUID(),name:name.trim(),host:host.trim(),port:Number(port)||9000,status:'unknown'};
    setComputers(x=>[...x,c]); setSelected(c.id); setName(''); setHost(''); setPort('9000'); setMessage('Computer saved. Click Test Connection.');
  };
  const remove = (id:string) => { setComputers(x=>x.filter(c=>c.id!==id)); if(selected===id) setSelected(''); };
  const current = computers.find(c=>c.id===selected);
  const title = menu.find(x=>x[0]===tab)?.[1] || 'Dashboard';

  const remoteView = <>
    <section className="card"><h2>Add Tally Computer</h2><div className="grid">
      <label>Computer Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Office Tally"/></label>
      <label>IP Address / Hostname<input value={host} onChange={e=>setHost(e.target.value)} placeholder="192.168.1.25"/></label>
      <label>Port<input value={port} onChange={e=>setPort(e.target.value)} inputMode="numeric"/></label>
      <button onClick={add}>＋ Save Computer</button>
    </div><small>Same LAN/VPN: use local IP. For another location use a secure VPN/bridge; never expose Tally port 9000 directly to the public Internet.</small></section>
    <section className="card"><div className="sectionHead"><div><h2>Saved Computers</h2><span>{computers.length} configured</span></div></div>
      {computers.length===0 ? <div className="empty">No Tally computer added yet.</div> : computers.map(c=><div className={`row ${selected===c.id?'selected':''}`} key={c.id} onClick={()=>setSelected(c.id)}>
        <i className={`dot ${c.status}`}/><div className="grow"><b>{c.name}</b><span>{c.host}:{c.port}</span></div><span className={`status ${c.status}`}>{c.status}</span>
        <button className="secondary" disabled={busy} onClick={e=>{e.stopPropagation();test(c)}}>Test</button>
        <button className="danger" onClick={e=>{e.stopPropagation();remove(c.id)}}>Delete</button>
      </div>)}
    </section>
    {current && <section className="card action"><div><div className="eyebrow">SELECTED COMPUTER</div><h2>{current.name}</h2><p>{current.host}:{current.port} • {current.status}</p></div>
      <div className="actions"><button disabled={busy} onClick={()=>test(current)}>{busy?'Connecting…':'Connect / Fetch Company'}</button><button className="secondary" disabled={busy} onClick={()=>legacy('Remote data','/api/company')}>Fetch Data</button></div>
    </section>}
  </>;

  const dashboardView = <section className="card dashboard"><h2>{title}</h2><p>Existing TallySync option. Remote Tally Computers is an additional option and does not replace this menu.</p>
    {tab==='dashboard' && <div className="tiles">
      <div><b>Company</b><span>Open company & sync</span><button onClick={()=>legacy('Company','/api/company')}>Open</button></div>
      <div><b>Sundry Debtors</b><span>Import debtor masters</span><button onClick={()=>legacy('Debtors','/api/debtors')}>Open</button></div>
      <div><b>Stock Items</b><span>Import stock masters</span><button onClick={()=>legacy('Stock Items','/api/items')}>Open</button></div>
      <div><b>Invoices</b><span>Sales invoices & push</span><button onClick={()=>legacy('Invoices','/api/invoices')}>Open</button></div>
      <div><b>Buffer Queue</b><span>Pending sync queue</span><button onClick={()=>legacy('Buffer Queue','/api/invoices?status=buffer')}>Open</button></div>
      <div><b>GSTR-1</b><span>Summary & JSON</span><button onClick={()=>legacy('GSTR-1','/api/gstr1/summary')}>Open</button></div>
      <div><b>Analytics</b><span>Sales & receivables</span><button onClick={()=>legacy('Analytics','/api/analytics')}>Open</button></div>
      <div><b>XML Export</b><span>Tally voucher XML</span><button onClick={()=>setMessage('Select an invoice to export its Tally XML.')}>Open</button></div>
    </div>}
  </section>;

  return <div className="app"><aside><div className="brand"><b>ANISHTECH</b><span>TallySync</span></div><nav>{menu.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{id==='remote'&&<em>NEW</em>}</button>)}</nav><div className="sideNote">TallyPrime Sync Console<br/><small>Existing options preserved</small></div></aside>
    <section className="content"><header><div><div className="eyebrow">ANISHTECH • TALLYSYNC</div><h1>{title}</h1><p>Enterprise TallyPrime synchronization console.</p></div><span className="online">● SYSTEM ONLINE</span></header>
      {message && <div className="message">{message}</div>}
      {tab==='remote' ? remoteView : dashboardView}
      <footer>Remote Tally Computer is an added option. Existing TallySync options are preserved.</footer>
    </section></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
