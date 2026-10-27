import { useEffect, useState } from 'react';
import { getV2Capabilities } from '@workspace/api-client-react';
import { boundedRequest } from './use-capture';
/** Older backends omit the optional capability; keep their existing actions. */
export function usePlaceCaptureAvailable() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let alive = true; void boundedRequest(signal => getV2Capabilities({ signal })).then(c => { if (alive) setEnabled(c.routeObservationsEnabled === true); }).catch(() => {}); return () => { alive = false; }; }, []);
  return enabled;
}

/** Read capability stays independent of writes and is absent on older servers. */
export function usePlaceReportsAvailable(){const [enabled,setEnabled]=useState(false);useEffect(()=>{let alive=true;void boundedRequest(signal=>getV2Capabilities({signal})).then(c=>{if(alive)setEnabled(c.placeReportsEnabled===true);}).catch(()=>{});return()=>{alive=false;};},[]);return enabled;}

export function usePickupQuestionAvailable() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let alive = true; void boundedRequest(signal => getV2Capabilities({ signal })).then(c => { if (alive) setEnabled(c.pickupQuestionsEnabled === true && c.routeObservationsEnabled === true); }).catch(() => {}); return () => { alive = false; }; }, []);
  return enabled;
}
