import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BusFront, Check, MapPin, Plus, X } from "lucide-react";
import "./LiveLocation.css";

type View = "location" | "route" | "update" | "review" | "received";

export function LiveLocation() {
  const [view, setView] = useState<View>("location");
  const [place, setPlace] = useState("");
  const [time, setTime] = useState("");
  const [driver, setDriver] = useState("");
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const modal = view !== "route";

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [view]);

  const routeContext = <div className="ll-context"><strong>Pavillion</strong><span>Harare <b>08:00</b> <ArrowRight size={11} aria-hidden="true" /> Bulawayo</span></div>;
  const back = () => setView(view === "review" ? "update" : "location");

  return (
    <div className="live-location">
      <div className="ll-prototype">Interactive prototype · no live data or submissions</div>
      <div className="ll-wordmark"><BusFront size={17} strokeWidth={1.6} /> mabhazi</div>
      <section ref={panel} className={`ll-modal ${!modal ? "ll-route-panel" : ""}`} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-labelledby="ll-heading"
        onKeyDown={e => {
          if (e.key === "Escape" && modal) { e.preventDefault(); setView("route"); }
          if (e.key !== "Tab" || !modal) return;
          const items = panel.current?.querySelectorAll<HTMLElement>('button, a, input, select, [tabindex="0"]');
          if (!items?.length) return;
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        <header>
          {["update", "review"].includes(view) && <button className="ll-back" aria-label="Back" onClick={back}><ArrowLeft size={18} /></button>}
          <h1 ref={titleRef} tabIndex={-1} id="ll-heading">{view === "route" ? "Your route" : view === "update" ? "Add a location" : view === "review" ? "Review update" : view === "received" ? "Update previewed" : "Live location window"}</h1>
          {modal && <button className="ll-close" aria-label="Close and return to route" onClick={() => setView("route")}><X size={17} /></button>}
        </header>
        <div className="ll-body">
          {routeContext}
          {view === "location" && <>
            <div className="ll-report">
              <div className="ll-report-top"><span><MapPin size={14} /> Last reported</span><time dateTime="09:17">09:17</time></div>
              <h2>Kadoma Garage</h2>
            </div>
            <dl className="ll-people">
              <div><dt>Contributor</dt><dd>Mashanji</dd></div>
              <div><dt>Driver’s call name</dt><dd>vaMoyo</dd></div>
            </dl>
            <p className="ll-disclaimer">Community report · not GPS tracking</p>
          </>}
          {view === "route" && <>
            <button className="ll-report ll-report-link" onClick={() => setView("location")}><div><span>Last reported · 09:17</span><strong>Kadoma Garage</strong></div><ArrowRight size={18} /></button>
            <div className="ll-route-links">
              <a href="/__mockup/preview/mabhazi/FocusedFare"><span>Know the fare?<small>Add the missing price</small></span><ArrowRight size={16} /></a>
              <a href="/__mockup/preview/mabhazi/Journey"><span>Report a journey<small>Share what happened on a trip</small></span><ArrowRight size={16} /></a>
            </div>
          </>}
          {view === "update" && <>
            <p className="ll-instruction">Where was this bus seen?</p>
            <form id="ll-update" onSubmit={e => {
              e.preventDefault();
              if (!place.trim()) { setError("Enter the reported place."); placeRef.current?.focus(); return; }
              if (!time) { setError("Choose the time it was seen."); timeRef.current?.focus(); return; }
              setError(""); setView("review");
            }} noValidate>
              <div className="ll-fields">
                <label>Place<input ref={placeRef} value={place} onChange={e => setPlace(e.target.value)} placeholder="e.g. Kadoma Garage" aria-invalid={!!error && !place.trim()} aria-describedby={error ? "ll-error" : undefined} /></label>
                <label>Time seen<input ref={timeRef} type="time" value={time} onChange={e => setTime(e.target.value)} aria-invalid={!!error && !time} aria-describedby={error ? "ll-error" : undefined} /></label>
                <label>Driver’s call name <span>Optional</span><input value={driver} onChange={e => setDriver(e.target.value)} placeholder="Only if known" /></label>
              </div>
              {error && <p id="ll-error" className="ll-error" role="alert">{error}</p>}
            </form>
            <p className="ll-disclaimer">Design example only · no location service connected</p>
          </>}
          {view === "review" && <>
            <div className="ll-report"><div className="ll-report-top"><span>Example observation</span><time>{time}</time></div><h2>{place}</h2></div>
            {driver.trim() && <dl className="ll-people"><div><dt>Driver’s call name</dt><dd>{driver}</dd></div></dl>}
            <p className="ll-disclaimer">Not submitted. The existing report stays unchanged.</p>
          </>}
          {view === "received" && <div className="ll-received"><span><Check size={24} /></span><h2>That’s the flow.</h2><p>In the app, your update would stay with this bus and route. Nothing was sent here.</p></div>}
        </div>
        <footer>
          {view === "location" && <><button className="ll-primary" onClick={() => setView("update")}><Plus size={17} /> Add an update</button><button className="ll-secondary" onClick={() => setView("route")}>Back to route</button></>}
          {view === "route" && <button className="ll-primary" onClick={() => setView("update")}><Plus size={17} /> Add a location update</button>}
          {view === "update" && <button type="submit" form="ll-update" className="ll-primary">Review update <ArrowRight size={16} /></button>}
          {view === "review" && <><button className="ll-primary" onClick={() => setView("received")}>Preview confirmation <ArrowRight size={16} /></button><button className="ll-secondary" onClick={() => setView("update")}>Edit</button></>}
          {view === "received" && <button className="ll-primary" onClick={() => setView("route")}>Back to route</button>}
        </footer>
      </section>
      <div className="ll-flow" aria-label="Flow position"><span className={view === "route" ? "current" : ""}>Route</span><span>›</span><span className={view === "location" ? "current" : ""}>Last report</span><span>›</span><span className={["update", "review", "received"].includes(view) ? "current" : ""}>Your update</span></div>
    </div>
  );
}
