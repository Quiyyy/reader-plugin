import type { Appearance } from '../shared/workspace';

// Appearance owns colors only. Workspace geometry never depends on this palette.
const rgb = (hex:string) => hex.slice(1).match(/../g)!.map(x => parseInt(x,16));
const luminance = (hex:string) => rgb(hex).map(n => {const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i]!,0);
const contrast = (a:string,b:string) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
const mix = (a:string,b:string,p:number) => '#'+rgb(a).map((x,i)=>Math.round(x*(1-p)+rgb(b)[i]!*p).toString(16).padStart(2,'0')).join('');

export function appearanceIsDark(mode:Appearance['mode'],hostTheme:string|undefined,systemDark:boolean) {
  return mode==='dark'||mode==='system'&&(hostTheme==='dark'||hostTheme!=='light'&&systemDark);
}

export function appearanceVariables(appearance:Appearance,dark:boolean):Record<string,string> {
  const paper=dark?'#252628':appearance.paper==='cream'?'#faf6ed':'#ffffff';
  let readable=appearance.accent;
  for(let i=0;i<18&&contrast(readable,paper)<4.5;i++)readable=mix(readable,dark?'#ffffff':'#000000',.12);
  return {
    '--study-bg':dark?'#1d1e20':'#fafaf9',
    '--study-paper':paper,
    '--study-soft':dark?'#2e3032':'#f1f2ef',
    '--study-rail':dark?'#18191b':'#f2f3f0',
    '--study-panel':dark?'#222325':'#f6f7f4',
    '--study-hover':dark?'#37393b':'#e8eae5',
    '--study-ink':dark?'#eceee8':'#282b27',
    '--study-muted':dark?'#adb2a9':'#697165',
    '--study-faint':dark?'#969c92':'#7a8176',
    '--study-border':dark?'#3b3e3b':'#dfe3da',
    '--study-control':dark?'#e4e9dc':'#30362c',
    '--study-on-control':dark?'#262b22':'#ffffff',
    '--study-shadow':dark?'0 18px 58px #0006,0 2px 6px #0003':'0 14px 48px #222b1b1a,0 2px 6px #222b1b0a',
    '--study-accent':appearance.accent,
    '--study-accent-ink':readable,
    '--study-tint':mix(appearance.accent,paper,dark?.85:.94),
    '--study-on-accent':contrast(appearance.accent,'#ffffff')>=contrast(appearance.accent,'#111111')?'#ffffff':'#111111',
    '--library-folder-blue':mix(appearance.accent,paper,dark?.4:.65),
    '--library-folder-blue-back':mix(appearance.accent,paper,dark?.25:.5),
    '--library-folder-pink':dark?'#ae7d94':'#eab3cb',
    '--library-folder-pink-back':dark?'#9b6e82':'#dba4bc',
    '--library-cover-green':dark?'#2e5a52':'#345f59',
    '--library-cover-brown':dark?'#69523f':'#78604c',
    '--library-cover-ink':dark?'#edf0df':'#f7f3df',
    '--library-notebook':mix(appearance.accent,paper,dark?.8:.94),
  };
}
