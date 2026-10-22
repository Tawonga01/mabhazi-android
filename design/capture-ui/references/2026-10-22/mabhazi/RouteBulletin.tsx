import { useState } from "react";
import { ArrowDown, ArrowRight, BusFront, Clock3, Info, MapPin, X } from "lucide-react";
import "./RouteBulletin.css";

export function RouteBulletin() {
  const [freshReport, setFreshReport] = useState(false);
  const [details, setDetails] = useState(false);
  const [open, setOpen] = useState(true);

  function changeExample(value: boolean) {
    setFreshReport(value);
    setDetails(false);
  }

  return (
    <main className="rb">
      <div className="rb-prototype">
        <span>Prototype · illustrative location</span>
        <div className="rb-demo" aria-label="Preview location source">
          <button aria-pressed={!freshReport} onClick={() => changeExample(false)}>No fresh report</button>
          <button aria-pressed={freshReport} onClick={() => changeExample(true)}>Fresh report</button>
        </div>
      </div>
      <div className="rb-brand"><BusFront size={18} strokeWidth={1.6}/>mabhazi</div>
      <article className="rb-sheet" aria-label="Bus location window">
        <header className="rb-mast">
          <h2>{open ? "Live location window" : "Your route"}</h2>
          {open && <button className="rb-close" aria-label="Close location window" onClick={() => setOpen(false)}><X size={17}/></button>}
        </header>
        <section className="rb-route">
          <h1>Harare <ArrowRight size={23} strokeWidth={1.3}/> Bulawayo</h1>
          <div className="rb-service"><strong>Pavillion</strong><span className="rb-dot"/><BusFront size={12}/><span>08:00 departure</span></div>
        </section>
        {open ? <>
          <section className={`rb-latest ${freshReport ? "" : "rb-estimated"}`} aria-labelledby="rb-location" aria-live="polite">
            <div className="rb-latest-label">
              {freshReport ? <MapPin size={13}/> : <Clock3 size={13}/>}
              {freshReport ? "Last reported location" : "Estimated location"}
              {!freshReport && <span className="rb-estimate-badge">Approximate</span>}
            </div>
            <h2 id="rb-location">{freshReport ? "Kadoma Garage" : "Near Kadoma"}</h2>
            <div className="rb-latest-bottom">
              {freshReport ? <><span>Reported by <strong>Mashanji</strong></span><time dateTime="09:17">09:17</time></> : <span>No fresh report available.</span>}
            </div>
          </section>
          <section className="rb-path" aria-label="Route context">
            <div className="rb-section-head"><span>Route context</span><span>Not to scale</span></div>
            <div className="rb-stop"><span className="rb-node solid"/><div className="rb-stop-title">Harare<small>Scheduled departure</small></div><time dateTime="08:00">08:00</time></div>
            <div className="rb-stop future"><span className={`rb-node ${freshReport ? "active" : "estimated"}`}/><div className="rb-stop-title">{freshReport ? "Kadoma Garage" : "Kadoma area"}<small>{freshReport ? "Last reported here" : "Approximate area · not a sighting"}</small></div>{freshReport && <time dateTime="09:17">09:17</time>}</div>
            <div className="rb-stop future"><span className="rb-node"/><div className="rb-stop-title">Bulawayo<small>Arrival not confirmed</small></div><ArrowDown size={13}/></div>
          </section>
          <p className="rb-note"><Info size={13}/>{freshReport ? "Community report · not GPS tracking." : "An estimate, not a confirmed bus position."}</p>
          <div className="rb-provenance">
            <span>{freshReport ? "Driver’s call name" : "Last reported driver"} · <strong>vaMoyo</strong></span>
            <button aria-expanded={details} aria-controls="rb-source-details" onClick={() => setDetails(!details)}>{details ? "Hide details" : freshReport ? "Report details" : "About this estimate"}</button>
          </div>
          {details && <div className="rb-detail" id="rb-source-details">
            {freshReport ? <><strong>Contributor:</strong> Mashanji<br/><strong>Report time:</strong> 09:17<br/>Fresh-report example. No live tracking connected.</> : <><strong>Illustrative estimate only.</strong> A real prediction service is not connected. This example does not calculate the bus position.<br/><br/><strong>Earlier report:</strong> Kadoma Garage · 09:17 · Mashanji.<br/>Driver’s call name vaMoyo comes from that report, not the estimate. No report date or freshness cutoff has been assumed.</>}
          </div>}
          <footer className="rb-actions"><button className="rb-primary" onClick={() => setOpen(false)}>Back to route</button></footer>
        </> : <div className="rb-return"><button className="rb-primary" onClick={() => setOpen(true)}><MapPin size={16}/>View bus location</button></div>}
      </article>
      <div className="rb-flow">Route › Bus location</div>
    </main>
  );
}
