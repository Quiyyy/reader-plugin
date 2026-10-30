export function NoteBotIcon({size=18,className}:{size?:number;className?:string}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <circle cx="8" cy="5" r="1.8"/><circle cx="16" cy="5" r="1.8"/>
    <circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="12" r="2.1"/><circle cx="20" cy="12" r="1.8"/>
    <circle cx="8" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/>
  </svg>;
}
