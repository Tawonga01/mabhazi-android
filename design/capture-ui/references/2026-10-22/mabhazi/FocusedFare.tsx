import { useRef, useState } from "react";
import { ArrowRight, BusFront, Check, ChevronDown, Ticket, X } from "lucide-react";
import "./FocusedFare.css";

export function FocusedFare() {
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [basis, setBasis] = useState("");
  const [date, setDate] = useState("");
  const [scope, setScope] = useState("Adult · single");
  const [other, setOther] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  function submit() {
    if (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      setError("Enter a fare amount. Use 0 only if it was free.");
      input.current?.focus();
      return;
    }
    if (!basis) { setError("Was this fare paid, quoted or advertised?"); return; }
    if (basis === "Paid" && !date) { setError("Add the date you travelled."); return; }
    if (scope === "Other" && !other.trim()) { setError("Describe who and what the fare covers."); return; }
    setError(""); setDone(true);
  }
  return (
    <div className="focused-fare">
      <div className="ff-prototype">INTERACTIVE PROTOTYPE <span>Nothing is submitted</span></div>
      <div className="ff-wordmark"><BusFront size={18} strokeWidth={1.6}/> mabhazi</div>
      {!open ? <section className="ff-route-page">
        <span className="ff-overline">COMMUNITY ROUTE · EXAMPLE</span>
        <h1>Harare <ArrowRight size={25}/> Bulawayo</h1>
        <div className="ff-service"><BusFront size={19}/><div><strong>Mavambo Coaches</strong><span>Departs 07:30</span></div></div>
        <div className="ff-invite"><Ticket size={22}/><h2>Know the fare?</h2><p>That’s the one detail missing.</p><button className="ff-primary" onClick={()=>{setDone(false);setOpen(true);}}>Add fare <ArrowRight size={16}/></button></div>
        <small>Synthetic route, not live travel information.</small>
      </section> : <section className="ff-modal" role="dialog" aria-modal="true" aria-labelledby="ff-heading">
        <header><span className="ff-modal-label">A little help goes a long way</span><button className="ff-close" aria-label="Close fare contribution" onClick={()=>setOpen(false)}><X size={17}/></button></header>
        {done ? <>
          <div className="ff-success"><div className="ff-success-icon"><Check size={27}/></div><h1 id="ff-heading">Thank you.</h1><p>Your fare preview is ready.</p><div className="ff-receipt"><strong>{currency} {Number(amount).toFixed(2)}</strong><span>Harare → Bulawayo · {basis.toLowerCase()}</span></div><small>Demo only. Nothing was submitted or verified.</small></div>
          <footer><button className="ff-primary" onClick={()=>setOpen(false)}>Done</button><button className="ff-skip" onClick={()=>setDone(false)}>Edit fare</button></footer>
        </> : <>
          <div className="ff-body">
            <div className="ff-context"><span className="ff-route-chip">Harare <ArrowRight size={12}/> Bulawayo</span><span className="ff-context-sub">07:30 · Mavambo Coaches</span></div>
            <div className="ff-heading"><div className="ff-ticket"><Ticket size={23} strokeWidth={1.6}/></div><h1 id="ff-heading">Know the fare?</h1><p>One missing detail. A big help.</p></div>
            <label className="ff-amount-label" htmlFor="ff-amount">Fare per person</label>
            <div className={`ff-amount-box ${error && !amount ? "ff-invalid" : ""}`}>
              <div className="ff-currency"><select aria-label="Currency" value={currency} onChange={e=>setCurrency(e.target.value)}><option>USD</option><option>ZAR</option><option>ZWG</option><option>BWP</option><option>ZMW</option><option>MZN</option></select><ChevronDown size={13}/></div>
              <input ref={input} id="ff-amount" inputMode="decimal" placeholder="—" value={amount} onChange={e=>{setAmount(e.target.value);setError("");}} aria-describedby={error?"ff-error":undefined}/>
            </div>
            <fieldset className="ff-basis"><legend>This fare was</legend><div>{["Paid","Quoted","Advertised"].map(b=><button key={b} aria-pressed={basis===b} className={basis===b?"selected":""} onClick={()=>{setBasis(b);setError("");}}>{b}</button>)}</div></fieldset>
            {basis==="Paid"&&<label className="ff-detail ff-date">Travel date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>}
            <label className="ff-detail"><span>Ticket</span><div className="ff-ticket-select"><select aria-label="Passenger and ticket type" value={scope} onChange={e=>setScope(e.target.value)}><option>Adult · single</option><option>Child · single</option><option>Adult · return</option><option>Other</option></select><ChevronDown size={13}/></div></label>
            {scope==="Other"&&<label className="ff-other">Who and what does it cover?<input value={other} onChange={e=>setOther(e.target.value)} placeholder="e.g. student, single ticket"/></label>}
            {error&&<p id="ff-error" role="alert" className="ff-error">{error}</p>}
          </div>
          <footer><button className="ff-primary" onClick={submit}>Preview fare <ArrowRight size={17}/></button><button className="ff-skip" onClick={()=>setOpen(false)}>Not sure? Skip</button></footer>
        </>}
      </section>}
      <div className="ff-bottom-note">Small details. Better journeys.</div>
    </div>
  );
}
