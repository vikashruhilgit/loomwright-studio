/* Loom avatars: sea creatures stitched from thread. A filled silhouette in the agent's hue, a running-stitch outline, inner stitch lines, a knot for the eye, and a loose thread end that carries the state. Wright is the crowned whale. */
const SHAPES={
  whale:{body:'<ellipse class="fill" cx="18" cy="17" rx="10" ry="7"/><path class="fill" d="M9 17c-3-1-5-3-6-6 0 4 0 8 0 12 1-3 3-5 6-6z"/><ellipse class="st" cx="18" cy="17" rx="10" ry="7"/><path class="st" d="M9 17c-3-1-5-3-6-6 0 4 0 8 0 12 1-3 3-5 6-6z"/><path class="ln" d="M17 24c-1 3 0 5 2 6M12 20c3 1 7 1 10 0M23 9c0-2 1-3 2-4M22 9c0-2-1-3-2-4"/><circle class="knot" cx="24" cy="15" r="1.3"/>',tail:[3,23],crown:[16,4]},
  shark:{body:'<path class="fill" d="M5 17c4-4 9-6 15-6 4 0 8 2 10 6-2 4-6 6-10 6-6 0-11-2-15-6z"/><path class="fill" d="M13 12c1-4 3-6 5-7 0 3 0 5-1 7z"/><path class="st" d="M5 17c4-4 9-6 15-6 4 0 8 2 10 6-2 4-6 6-10 6-6 0-11-2-15-6z"/><path class="st" d="M13 12c1-4 3-6 5-7 0 3 0 5-1 7zM5 17c-2-3-3-5-3-8 2 2 4 4 6 5M5 17c-2 3-3 5-3 8 2-2 4-4 6-5"/><path class="ln" d="M22 15v4M24 15v4M18 22c1 2 2 3 3 3"/><circle class="knot" cx="26" cy="16" r="1.2"/>',tail:[2,25]},
  seahorse:{body:'<path class="fill" d="M18 4c4 0 6 3 6 7 0 5-4 8-6 12-1 3 0 5 2 6-4 0-7-3-6-7 1-4 5-7 5-11 0-2-1-3-2-3-2 0-3 1-4 2l-4-1c1-3 5-5 9-5z"/><path class="st" d="M18 4c4 0 6 3 6 7 0 5-4 8-6 12-1 3 0 5 2 6-4 0-7-3-6-7 1-4 5-7 5-11 0-2-1-3-2-3-2 0-3 1-4 2l-4-1c1-3 5-5 9-5z"/><path class="ln" d="M9 9h-4M22 8l2-2M23 12l3-1M20 16l3 1M16 22h3"/><circle class="knot" cx="18" cy="8" r="1.2"/>',tail:[20,29]},
  octopus:{body:'<circle class="fill" cx="16" cy="12" r="8"/><circle class="st" cx="16" cy="12" r="8"/><path class="ln" d="M9 18c-2 4-4 7-2 11M13 19c-1 4-1 8 1 11M19 19c1 4 1 8-1 11M23 18c2 4 4 7 2 11"/><circle class="knot" cx="13" cy="12" r="1.2"/><circle class="knot" cx="19" cy="12" r="1.2"/>',tail:[27,22]},
  turtle:{body:'<ellipse class="fill" cx="15" cy="17" rx="10" ry="7"/><circle class="fill" cx="27" cy="15" r="3"/><ellipse class="st" cx="15" cy="17" rx="10" ry="7"/><circle class="st" cx="27" cy="15" r="3"/><path class="ln" d="M8 17h14M11 12l2 5M19 12l-2 5M11 22l2-5M19 22l-2-5M8 12l-4-3M8 22l-4 3M22 22l3 3"/><circle class="knot" cx="28" cy="14" r="1"/>',tail:[4,17]},
  jellyfish:{body:'<path class="fill" d="M6 15a10 8 0 0 1 20 0c-3 2-7 3-10 3s-7-1-10-3z"/><path class="st" d="M6 15a10 8 0 0 1 20 0c-3 2-7 3-10 3s-7-1-10-3z"/><path class="ln" d="M10 18c-1 4 1 7 0 11M14 19c-1 4 1 7 0 10M18 19c1 4-1 7 0 10M22 18c1 4-1 7 0 11M10 12c2-2 10-2 12 0"/><circle class="knot" cx="13" cy="14" r="1"/><circle class="knot" cx="19" cy="14" r="1"/>',tail:[26,16]},
  fish:{body:'<ellipse class="fill" cx="15" cy="16" rx="9" ry="6"/><path class="fill" d="M6 16l-4-5v10z"/><ellipse class="st" cx="15" cy="16" rx="9" ry="6"/><path class="st" d="M6 16l-4-5v10zM14 10c1-3 3-4 5-4-1 2-1 4-2 5z"/><path class="ln" d="M12 11v10M16 11v10M15 22c1 2 3 3 4 3"/><circle class="knot" cx="20" cy="15" r="1.2"/>',tail:[24,17]},
  crab:{body:'<ellipse class="fill" cx="16" cy="18" rx="9" ry="6"/><circle class="fill" cx="5" cy="12" r="3"/><circle class="fill" cx="27" cy="12" r="3"/><ellipse class="st" cx="16" cy="18" rx="9" ry="6"/><circle class="st" cx="5" cy="12" r="3"/><circle class="st" cx="27" cy="12" r="3"/><path class="ln" d="M8 14l-2-1M24 14l2-1M8 20l-4 3M9 22l-3 4M24 20l4 3M23 22l3 4M12 12v-3M20 12v-3"/><circle class="knot" cx="12" cy="9" r="1.2"/><circle class="knot" cx="20" cy="9" r="1.2"/>',tail:[24,24]},
};
const SHAPE_ORDER=Object.keys(SHAPES).filter(s=>s!=='whale');
const HUES={accent:'--accent',ok:'--ok',parked:'--parked',attention:'--attention',danger:'--danger'};
const seedOf=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))>>>0;return (h%40)/10};
function avatarHTML(a,state,size,title){
  state=state||agentState(a.id); size=size||32;
  const key=a.id==='wright'?'whale':(a.shape in SHAPES?a.shape:'fish'); const sh=SHAPES[key]; const [tx,ty]=sh.tail;
  const label=`${a.name} · ${stateWord[state]||state}${title?' · '+title:''}`;
  const tails=`<g class="tail" style="transform-origin:${tx}px ${ty}px"><path class="t t-idle" d="M${tx} ${ty}c-3 1-5 3-4 7"/><path class="t t-up" d="M${tx} ${ty}c-5-1-7-6-3-9 3-2 5 2 2 3"/><path class="t t-slack" d="M${tx} ${ty}c-1 3-1 8 0 12"/><path class="t t-cut" d="M${tx} ${ty}c-2 0-3 1-3 2"/><path class="t t-cut2" d="M${tx-5} ${ty+5}c-1 1-2 3-1 5"/><path class="t t-bow" d="M${tx} ${ty}c-3-3-6-2-4 1s5 0 4-1c1-3 5-2 3 1s-5 0-3-1"/></g>`;
  const crown=a.id==='wright'?`<path class="crown" d="M${sh.crown[0]-6.5} ${sh.crown[1]+4.5}l1.5-5 3 3 2-4.5 2 4.5 3-3 1.5 5z"/>`:'';
  return `<span class="bot ${state} ${a.id==='wright'?'lead':''}" style="--s:${size}px;--bot:var(${HUES[a.hue||'accent']});--seed:-${seedOf(a.id)}s" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="ring" aria-hidden="true"></span><svg viewBox="-2 -2 36 36"><circle class="stitch" cx="16" cy="16" r="16.5"/><g class="drift"><g class="rig">${sh.body}${crown}${tails}</g></g></svg></span>`;
}
function celebrate(agentId){
  const nm=agent(agentId)?.name||'';
  $$(`.bot[aria-label^="${CSS.escape(nm)} ·"]`).forEach(el=>{el.classList.remove('idle','working','waiting','parked');el.classList.add('done')});
  setTimeout(render,1200);
}
