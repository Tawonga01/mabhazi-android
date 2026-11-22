export function departureCountdown(nextDepartureAt:string|null|undefined,now:number):string|null {
 if(!nextDepartureAt||!Number.isFinite(now))return null;
 const left=Date.parse(nextDepartureAt)-now;
 if(!Number.isFinite(left)||left<=0)return null;
 const minutes=Math.ceil(left/60000),hours=Math.floor(minutes/60),rest=minutes%60;
 return hours?hours+'h '+rest+'m':minutes+'m';
}
export function departureClock(value:string|null|undefined):string {
 if(!value||!/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(value))return '—';
 const hour=Number(value.slice(0,2));return (hour%12||12)+value.slice(2,5)+(hour<12?' AM':' PM');
}
