// SPDX-License-Identifier: AGPL-3.0-only
/** Data-only host appearance. No executable hooks, CSS, fonts, artwork or remote URLs. */
export function brandName(value:unknown):string {
  if(value===undefined)return 'EndToEnd'
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>48||!/^[A-Za-z0-9][A-Za-z0-9 .&'-]*$/.test(value))throw new Error('Brand name must be 1–48 plain characters')
  return value
}
const defaults={background:'#101b2a',surface:'#18283c',text:'#e7edf6',border:'#405675',button:'#a8d6ff',buttonText:'#101b2a',focus:'#a8d6ff',link:'#a8d6ff'}
export type AgentPalette=typeof defaults
function luminance(color:string){
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722
}
export function contrast(left:string,right:string){const a=luminance(left),b=luminance(right);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
function readable(color:string,surface:string,minimum:number){return contrast(color,surface)>=minimum?color:contrast('#000000',surface)>contrast('#ffffff',surface)?'#000000':'#ffffff'}
export function agentAppearance(encoded:string|null){
  let palette={...defaults}
  if(encoded!==null){
    if(encoded.length>1024)throw new Error('Appearance data is too large')
    const input=JSON.parse(encoded)
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))throw new Error('Appearance contains unsupported fields')
    for(const [key,value] of Object.entries(input)){
      if(typeof value!=='string'||!/^#[a-fA-F0-9]{6}$/.test(value))throw new Error('Appearance accepts only six-digit hex colors')
      palette[key as keyof AgentPalette]=value.toLowerCase()
    }
  }
  palette.text=readable(palette.text,palette.surface,4.5)
  palette.buttonText=readable(palette.buttonText,palette.button,4.5)
  palette.border=readable(palette.border,palette.surface,3)
  palette.focus=readable(palette.focus,palette.surface,3)
  palette.link=readable(palette.link,palette.surface,4.5)
  return {palette,pageText:readable(palette.text,palette.background,4.5),colorScheme:luminance(palette.background)>.179?'light':'dark'}
}
