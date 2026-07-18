// tools_ui.ts — 工具箱页面。8 个工具,全部浏览器本地运行,数据不离开浏览器。
// Base64 / 节点解析 / JWT / 哈希+HMAC / AES / JSON / 正则 / 编码透视

import { ADMIN_PATH } from "./config.ts";

const STYLE = `<style>
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap');
  :root{--bg:#f3f2f2;--fg:#1a1a1a;--muted:#6b6b68;--accent:#ec3013;--bd:#1a1a1a;--bd2:#c9c7c3}
  *{box-sizing:border-box}
  body{font-family:'Archivo',system-ui,-apple-system,sans-serif;max-width:1120px;margin:0 auto;padding:20px 20px 60px;color:var(--fg);background:var(--bg)}
  a.back{color:var(--accent);text-decoration:none;font-size:13px;font-weight:600}
  h1{font-size:22px;font-weight:800;letter-spacing:-.01em;margin:16px 0 4px}
  .lead{color:var(--muted);font-size:13px;margin:0 0 20px;line-height:1.6}
  .tools-layout{display:flex;align-items:stretch;border:2px solid var(--bd);background:#fff;min-height:480px}
  .tools-nav{width:210px;flex-shrink:0;border-right:2px solid var(--bd);display:flex;flex-direction:column;background:var(--bg)}
  .tools-nav a{padding:13px 16px;color:var(--fg);text-decoration:none;font-size:13px;font-weight:600;border-bottom:1px solid var(--bd2);cursor:pointer}
  .tools-nav a:hover{color:var(--accent)}
  .tools-nav a.active{background:var(--fg);color:#fff;border-bottom-color:var(--fg)}
  .tools-content{flex:1;padding:20px 24px;min-width:0}
  .tool-panel{display:none}
  .tool-panel.active{display:block}
  .tool-panel h3{margin:0 0 4px;font-size:16px;font-weight:700}
  .tool-panel .hint{color:var(--muted);font-size:12px;margin:0 0 14px;line-height:1.5}
  textarea,input,select{width:100%;font:inherit;font-size:13px;padding:9px 10px;border:2px solid var(--bd);border-radius:0;outline:none;font-family:ui-monospace,Menlo,monospace;background:#fff;color:var(--fg)}
  textarea:focus,input:focus,select:focus{border-color:var(--accent)}
  textarea{resize:vertical;line-height:1.5}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
  button{font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border:2px solid var(--bd);border-radius:0;background:#fff;color:var(--fg);cursor:pointer;transition:.12s}
  button:hover{background:var(--fg);color:#fff}
  button.p{background:var(--fg);color:#fff;border-color:var(--fg)}
  button.p:hover{background:var(--accent);border-color:var(--accent)}
  .out{margin-top:8px;background:var(--bg);border:2px solid var(--bd2);padding:10px;font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;min-height:20px;max-height:320px;overflow:auto}
  .out.err{color:#a3200f;background:#fdeceb;border-color:var(--accent)}
  label{font-size:12px;color:var(--muted)}
  .mini{font-size:12px;color:var(--muted)}
  @media(max-width:680px){
    .tools-layout{flex-direction:column}
    .tools-nav{width:100%;flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:2px solid var(--bd)}
    .tools-nav a{border-bottom:none;border-right:1px solid var(--bd2)}
  }

  /* 节点解析结果:卡片网格 */
  .node-result{margin-top:14px}
  .result-header .kicker{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:4px}
  .result-header .uri-line{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--muted);word-break:break-all;margin-top:6px}
  .fact-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0;margin:14px 0 18px;border:2px solid var(--bd)}
  .fact-card{background:#fff;padding:14px 16px;display:flex;flex-direction:column;gap:6px;border-left:1px solid var(--bd2)}
  .fact-card:first-child{border-left:none}
  .fact-card .f-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
  .fact-card .f-value{font-weight:700;font-size:20px}
  .fact-card .f-basis{font-size:11px;color:var(--muted);line-height:1.5}
  .score-legend{display:flex;gap:14px;font-size:10px;color:var(--muted);margin-bottom:8px;justify-content:flex-end}
  .score-legend span{display:flex;align-items:center;gap:4px}
  .legend-dot{width:8px;height:8px;display:inline-block;background:var(--accent)}
  .legend-dot.theory{background:none;border:1px solid var(--bd2)}
  .score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border:2px solid var(--bd)}
  .score-card{background:#fff;padding:14px 16px;display:flex;flex-direction:column;gap:8px;position:relative;border-left:1px solid var(--bd2);border-top:1px solid var(--bd2)}
  .score-card:first-child{border-top:none;border-left:none}
  .score-card.theoretical{background:repeating-linear-gradient(135deg,#fff,#fff 8px,var(--bg) 8px,var(--bg) 9px)}
  .score-card .tag-corner{position:absolute;top:10px;right:10px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:2px 6px}
  .score-card .tag-corner.theory{border:1px solid var(--bd2);color:var(--muted)}
  .score-card .tag-corner.real{background:var(--accent);color:#fff}
  .score-card .s-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
  .score-card .dots{display:flex;gap:5px}
  .score-card .dot{width:11px;height:11px;background:var(--bd2)}
  .score-card .dot.on{background:var(--accent)}
  .score-card .s-basis{font-size:11px;color:var(--muted);line-height:1.5}
</style>`;

export function toolsPage(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
  <a class="back" id="back-link" href="${ADMIN_PATH}">← 返回后台</a>
  <h1>工具箱</h1>
  <p class="lead">全部工具在你的浏览器本地运行,输入内容不会发送到服务器或任何第三方。</p>

  <div class="tools-layout">
    <nav class="tools-nav">
      <a data-tool="b64" class="active" onclick="showTool('b64',this)">Base64 编解码</a>
      <a data-tool="node" onclick="showTool('node',this)">节点链接解析</a>
      <a data-tool="jwt" onclick="showTool('jwt',this)">JWT 解码</a>
      <a data-tool="hash" onclick="showTool('hash',this)">哈希 / HMAC</a>
      <a data-tool="aes" onclick="showTool('aes',this)">AES 加解密</a>
      <a data-tool="json" onclick="showTool('json',this)">JSON 格式化</a>
      <a data-tool="regex" onclick="showTool('regex',this)">正则测试</a>
      <a data-tool="xray" onclick="showTool('xray',this)">编码透视</a>
    </nav>

    <div class="tools-content">

      <div class="tool-panel active" id="tool-b64">
        <h3>Base64 编解码</h3>
        <p class="hint">支持 UTF-8 中文;勾选 URL-safe 处理 -_ 变体。</p>
        <textarea id="b64in" rows="3" placeholder="输入文本或 Base64"></textarea>
        <div class="row">
          <button class="p" onclick="b64('enc')">编码 →</button>
          <button class="p" onclick="b64('dec')">← 解码</button>
          <label><input type="checkbox" id="b64url" style="width:auto"> URL-safe</label>
        </div>
        <div class="out" id="b64out"></div>
      </div>

      <div class="tool-panel" id="tool-node">
        <h3>节点链接解析</h3>
        <p class="hint">粘一条 vmess:// vless:// trojan:// anytls:// ss:// 看解析结果和几个维度的评估。</p>
        <textarea id="nodein" rows="3" placeholder="vmess://..."></textarea>
        <div class="row"><button class="p" onclick="parseNode()">解析</button></div>
        <div class="out err" id="nodeerr" style="display:none"></div>
        <div id="nodeout"></div>
      </div>

      <div class="tool-panel" id="tool-jwt">
        <h3>JWT 解码</h3>
        <p class="hint">解出 header / payload,不验证签名。本地解码。</p>
        <textarea id="jwtin" rows="3" placeholder="eyJhbGciOi..."></textarea>
        <div class="row"><button class="p" onclick="jwt()">解码</button></div>
        <div class="out" id="jwtout"></div>
      </div>

      <div class="tool-panel" id="tool-hash">
        <h3>哈希 / HMAC</h3>
        <p class="hint">SHA-1/256/384/512。填密钥则算 HMAC。</p>
        <textarea id="hin" rows="2" placeholder="要哈希的文本"></textarea>
        <div class="row">
          <select id="halg" style="width:auto">
            <option>SHA-256</option><option>SHA-1</option><option>SHA-384</option><option>SHA-512</option>
          </select>
          <input id="hkey" placeholder="HMAC 密钥(可空)" style="flex:1;min-width:120px">
          <button class="p" onclick="hash()">计算</button>
        </div>
        <div class="out" id="hout"></div>
      </div>

      <div class="tool-panel" id="tool-aes">
        <h3>AES 加解密</h3>
        <p class="hint">AES-GCM + 口令(PBKDF2)。密文含盐和 IV,可跨次解密。</p>
        <textarea id="aesin" rows="2" placeholder="明文 或 密文(Base64)"></textarea>
        <input id="aespw" type="password" placeholder="口令" style="margin-top:6px">
        <div class="row">
          <button class="p" onclick="aes('enc')">加密 →</button>
          <button class="p" onclick="aes('dec')">← 解密</button>
        </div>
        <div class="out" id="aesout"></div>
      </div>

      <div class="tool-panel" id="tool-json">
        <h3>JSON 格式化 / 压缩</h3>
        <p class="hint">美化展开或压成一行。</p>
        <textarea id="jin" rows="4" placeholder='{"a":1}'></textarea>
        <div class="row">
          <button class="p" onclick="jsonfmt('pretty')">格式化</button>
          <button class="p" onclick="jsonfmt('min')">压缩</button>
        </div>
        <div class="out" id="jout"></div>
      </div>

      <div class="tool-panel" id="tool-regex">
        <h3>正则测试</h3>
        <p class="hint">实时匹配,显示命中项与分组。</p>
        <div class="row">
          <input id="rePat" placeholder="正则,如 \\d+" style="flex:1" oninput="regex()">
          <input id="reFlags" placeholder="flags 如 gi" style="width:90px" oninput="regex()">
        </div>
        <textarea id="reText" rows="3" placeholder="测试文本" oninput="regex()"></textarea>
        <div class="out" id="reout"></div>
      </div>

      <div class="tool-panel" id="tool-xray">
        <h3>编码透视</h3>
        <p class="hint">一段文本的 Hex / Base64 / URL / Unicode / 字节数。</p>
        <textarea id="xin" rows="2" placeholder="输入文本" oninput="xray()"></textarea>
        <div class="out" id="xout"></div>
      </div>

    </div>
  </div>

<script>
function showTool(name, el){
  document.querySelectorAll('.tool-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tool-'+name).classList.add('active');
  document.querySelectorAll('.tools-nav a').forEach(a=>a.classList.remove('active'));
  el.classList.add('active');
  try{ history.replaceState(null,'','#'+name); }catch(e){}
}
(function(){
  const h=(location.hash||'').replace('#','');
  if(h){ const el=document.querySelector('.tools-nav a[data-tool="'+h+'"]'); if(el) showTool(h,el); }
})();
const $=id=>document.getElementById(id);
function show(id,txt,err){const e=$(id);e.textContent=txt;e.classList.toggle('err',!!err);}
const enc=new TextEncoder(), dec=new TextDecoder();
function toB64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
function fromB64(b64){const s=atob(b64);const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}

// Base64
function b64(mode){
  try{
    const v=$('b64in').value; const url=$('b64url').checked;
    if(mode==='enc'){let o=toB64(enc.encode(v)); if(url)o=o.replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); show('b64out',o);}
    else{let s=v.trim(); if(url)s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; show('b64out',dec.decode(fromB64(s)));}
  }catch(e){show('b64out','错误:'+e.message,1);}
}

// 节点解析
function normalizeNode(u){
  if(u.startsWith('vmess://')){
    const j = JSON.parse(dec.decode(fromB64(u.slice(8))));
    return { protocol:'vmess', server:j.add||'-', port:j.port||'', name:j.ps||'', security: j.tls==='tls'?'tls':'none' };
  }
  if(u.startsWith('vless://')||u.startsWith('trojan://')||u.startsWith('anytls://')){
    const x=new URL(u);
    const proto = x.protocol.replace(':','');
    const params = Object.fromEntries(x.searchParams);
    let security = 'none';
    if(proto==='vless') security = params.security||'none';
    else if(proto==='trojan'||proto==='anytls') security = 'tls';
    return { protocol:proto, server:x.hostname, port:x.port, name:decodeURIComponent(x.hash.slice(1)||''), security };
  }
  if(u.startsWith('ss://')){
    let rest=u.slice(5); const h=rest.indexOf('#');
    const name=h>=0?decodeURIComponent(rest.slice(h+1)):''; if(h>=0)rest=rest.slice(0,h);
    let server='-',port='';
    if(rest.includes('@')){
      const at=rest.lastIndexOf('@');
      const hp=rest.slice(at+1); const lc=hp.lastIndexOf(':');
      server=hp.slice(0,lc); port=hp.slice(lc+1);
    }
    return { protocol:'ss', server, port, name, security:'-' };
  }
  throw new Error('无法识别的协议(支持 vmess/vless/trojan/anytls/ss)');
}

function speedSortValue(s){
  const m = String(s).match(/(\\d+(?:\\.\\d+)?)\\s*([KMGT]?)B\\/s/i);
  if(!m) return -1;
  const n = parseFloat(m[1]); const unit = m[2].toUpperCase();
  const mult = unit==='G'?1024*1024 : unit==='M'?1024 : unit==='K'?1 : 1/1024;
  return n*mult;
}

// IP 纯净度判断:最优先用关键词,其次找一个 0-100 的纯净度/风险数字。
// 具体 subs-check 把这个写成什么文字格式还没拿真实样本核对过,这几个关键词是按最常见的写法猜的,
// 以后拿到真实样本发现不匹配再调整这里就行,不影响别的逻辑。
function ipPurityTier(name){
  const n = name.toLowerCase();
  if(/(住宅|residential|mobile|cellular|家宽|dynamic)/.test(n)) return {tier:'clean', label:'住宅/移动 IP'};
  if(/(idc|数据中心|机房|datacenter|hosting|cloud|vps|colo)/.test(n)) return {tier:'dirty', label:'数据中心/机房 IP'};
  const m = name.match(/(?:iprisk|纯净度|risk)[:：]?\\s*(\\d{1,3})/i);
  if(m){
    const score = Number(m[1]);
    if(score>=80) return {tier:'clean', label:'纯净度 '+score};
    if(score>=50) return {tier:'mid', label:'纯净度 '+score};
    return {tier:'dirty', label:'纯净度 '+score};
  }
  return null;
}

function computeDimensions(info){
  const name = info.name||'';
  const n = name.toLowerCase();

  // AI亲缘度:优先用IP纯净度判断(住宅/移动IP几乎不会被AI服务额外审查,数据中心IP最容易被盯上),
  // 有实测的AI平台可达性(Claude/ChatGPT/Gemini)会在此基础上加分;两者都没有就退回纯粹数平台命中数量。
  const aiKeys = { claude:'Claude', chatgpt:'ChatGPT', openai:'ChatGPT', gemini:'Gemini' };
  const hitAI = new Set();
  for(const k in aiKeys){ if(n.includes(k)) hitAI.add(aiKeys[k]); }
  const purity = ipPurityTier(name);
  let aiScore, aiEvidence;
  if(purity){
    aiScore = purity.tier==='clean'?5 : purity.tier==='mid'?3 : 2;
    aiEvidence = 'IP 判定为 '+purity.label;
    if(hitAI.size){ aiScore = Math.min(5, aiScore+1); aiEvidence += ';另外实测通过 '+[...hitAI].join('、'); }
  } else if(hitAI.size){
    aiScore = hitAI.size===1?3 : hitAI.size===2?4 : 5;
    aiEvidence = '名字里测到: '+[...hitAI].join('、');
  } else {
    aiScore = 1;
    aiEvidence = '没有 IP 纯净度或 AI 平台可达性信息(可能没开检测,或都没通过)';
  }

  const speedBadge = name.split('|').map(s=>s.trim()).find(b=>/\\d+(\\.\\d+)?\\s*[KMGT]?B\\/s/i.test(b)) || '-';
  const spd = speedSortValue(speedBadge);
  const speedScore = spd<0?null : spd<100?1 : spd<300?2 : spd<600?3 : spd<1500?4 : 5;
  const speedEvidence = spd<0 ? '没有测速信息' : speedBadge+'(≈'+Math.round(spd)+' KB/s)';

  let gfwScore=1, gfwEvidence='明文/无TLS,极易被识别';
  if(info.security==='reality'){ gfwScore=5; gfwEvidence='Reality:伪装成真实网站的TLS握手,目前最难识别的一类'; }
  else if(info.protocol==='anytls'){ gfwScore=4; gfwEvidence='anytls:专门设计用来抵抗TLS会话特征识别'; }
  else if(info.protocol==='trojan'){ gfwScore=3; gfwEvidence='trojan:走标准TLS,外观像HTTPS,但长期流量模式仍可能被分析'; }
  else if(info.security==='tls'){ gfwScore=3; gfwEvidence='标准TLS,比明文好但指纹相对固定'; }
  else if(info.protocol==='vmess'){ gfwScore=2; gfwEvidence='vmess:较老协议,特征已被广泛研究'; }

  let secScore=1, secEvidence='没有加密层,明文传输';
  if(info.security==='reality'){ secScore=5; secEvidence='Reality:双重加密+借用真实证书,被动窃听方拿不到真实SNI'; }
  else if(info.protocol==='anytls'||info.protocol==='trojan'||info.security==='tls'){ secScore=4; secEvidence='标准TLS加密,但SNI仍是明文可见(除非另外开ECH)'; }
  else if(info.protocol==='ss'){ secScore=3; secEvidence='基于对称加密,没有TLS层伪装'; }

  const sm = name.match(/⏱(\\d+)天(\\d+)次/);
  let stabScore=null, stabEvidence='还没有历史记录(下次推送后才会有)';
  if(sm){
    const days=Number(sm[1]), times=Number(sm[2]);
    stabScore = times>=20?5 : times>=10?4 : times>=5?3 : times>=2?2 : 1;
    stabEvidence = '首次出现于 '+days+' 天前,累计被选中 '+times+' 次';
  }

  return [
    { label:'AI亲缘度', score:aiScore, evidence:aiEvidence, real:true },
    { label:'速度', score:speedScore, evidence:speedEvidence, real:true },
    { label:'GFW对抗强度', score:gfwScore, evidence:gfwEvidence, real:false },
    { label:'保密性', score:secScore, evidence:secEvidence, real:false },
    { label:'连接稳定性', score:stabScore, evidence:stabEvidence, real:true },
  ];
}

function clientCompat(proto){
  if(proto==='vless') return 'v2rayN / V2Box / sing-box / Shadowrocket / Clash 全部支持';
  if(proto==='trojan') return '几乎所有主流客户端都支持';
  if(proto==='anytls') return '目前只有 sing-box 系客户端支持(mihomo/Clash Verge等),V2Box/旧版v2rayN不支持';
  if(proto==='vmess') return '老牌协议,兼容性广但已不是主流推荐';
  if(proto==='ss') return 'Shadowsocks,兼容性广,但没有TLS伪装层';
  return '未知协议';
}

function renderNodeCards(info, rawUri){
  const areaBadge = (info.name||'').split('|').map(s=>s.trim()).filter(Boolean)[0] || '-';
  const dims = computeDimensions(info);

  const factHtml = ''
    + '<div class="fact-card">'
    +   '<div class="f-label">地区</div>'
    +   '<div class="f-value">'+areaBadge.replace(/</g,'&lt;')+'</div>'
    +   '<div class="f-basis">来自节点名字里的地区标记(按出口IP识别)</div>'
    + '</div>'
    + '<div class="fact-card">'
    +   '<div class="f-label">客户端兼容性</div>'
    +   '<div class="f-value" style="font-size:14px;line-height:1.4">'+clientCompat(info.protocol)+'</div>'
    +   '<div class="f-basis">协议: '+info.protocol+'</div>'
    + '</div>';

  const scoreHtml = dims.map(d=>{
    const dots = Array.from({length:5}, (_,i)=> '<div class="dot'+(d.score!=null && i<d.score?' on':'')+'"></div>').join('');
    const tag = d.real ? '<div class="tag-corner real">实测</div>' : '<div class="tag-corner theory">理论推算</div>';
    return '<div class="score-card'+(d.real?'':' theoretical')+'">'
      + tag
      + '<div class="s-label">'+d.label+'</div>'
      + '<div class="dots">'+dots+'</div>'
      + '<div class="s-basis">'+d.evidence.replace(/</g,'&lt;')+'</div>'
      + '</div>';
  }).join('');

  return '<div class="node-result">'
    + '<div class="result-header">'
    +   '<div class="kicker">解析结果</div>'
    +   '<div class="uri-line">'+rawUri.replace(/</g,'&lt;')+'</div>'
    + '</div>'
    + '<div class="fact-grid">'+factHtml+'</div>'
    + '<div class="score-legend">'
    +   '<span><span class="legend-dot"></span>实测</span>'
    +   '<span><span class="legend-dot theory"></span>理论推算</span>'
    + '</div>'
    + '<div class="score-grid">'+scoreHtml+'</div>'
    + '</div>';
}

function parseNode(){
  const errBox = $('nodeerr'), outBox = $('nodeout');
  try{
    const u = $('nodein').value.trim();
    const info = normalizeNode(u);
    errBox.style.display = 'none';
    outBox.innerHTML = renderNodeCards(info, u);
  }catch(e){
    outBox.innerHTML = '';
    errBox.style.display = 'block';
    errBox.textContent = '错误:'+e.message;
  }
}

// JWT
function jwt(){
  try{
    const p=$('jwtin').value.trim().split('.'); if(p.length<2)throw new Error('不是有效 JWT');
    const b=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return JSON.parse(dec.decode(fromB64(s)));};
    const head=b(p[0]),body=b(p[1]); let extra='';
    if(body.exp){const d=new Date(body.exp*1000);extra='\\n\\n过期时间: '+d.toLocaleString()+(d<new Date()?' (已过期)':' (有效)');}
    show('jwtout','HEADER:\\n'+JSON.stringify(head,null,2)+'\\n\\nPAYLOAD:\\n'+JSON.stringify(body,null,2)+extra);
  }catch(e){show('jwtout','错误:'+e.message,1);}
}

// 哈希 / HMAC
async function hash(){
  try{
    const data=enc.encode($('hin').value); const alg=$('halg').value; const key=$('hkey').value;
    let out;
    if(key){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:alg},false,['sign']);out=await crypto.subtle.sign('HMAC',k,data);}
    else out=await crypto.subtle.digest(alg,data);
    show('hout',(key?'HMAC-':'')+alg+':\\n'+hex(new Uint8Array(out)));
  }catch(e){show('hout','错误:'+e.message,1);}
}

// AES-GCM + PBKDF2
async function deriveKey(pw,salt){const base=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:120000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function aes(mode){
  try{
    const pw=$('aespw').value; if(!pw)throw new Error('请填口令');
    if(mode==='enc'){
      const salt=crypto.getRandomValues(new Uint8Array(16)); const iv=crypto.getRandomValues(new Uint8Array(12));
      const key=await deriveKey(pw,salt); const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode($('aesin').value)));
      const all=new Uint8Array(16+12+ct.length); all.set(salt,0);all.set(iv,16);all.set(ct,28);
      show('aesout',toB64(all));
    }else{
      const all=fromB64($('aesin').value.trim()); const salt=all.slice(0,16),iv=all.slice(16,28),ct=all.slice(28);
      const key=await deriveKey(pw,salt); const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
      show('aesout',dec.decode(pt));
    }
  }catch(e){show('aesout','错误:'+e.message+' (解密失败通常是口令错或密文不完整)',1);}
}

// JSON
function jsonfmt(mode){try{const o=JSON.parse($('jin').value);show('jout',JSON.stringify(o,null,mode==='pretty'?2:0));}catch(e){show('jout','错误:'+e.message,1);}}

// 正则
function regex(){
  try{
    const p=$('rePat').value; if(!p){show('reout','');return;}
    const re=new RegExp(p,$('reFlags').value); const t=$('reText').value;
    const ms=[...t.matchAll(re.flags.includes('g')?re:new RegExp(p,$('reFlags').value+'g'))];
    if(!ms.length){show('reout','无匹配');return;}
    show('reout','匹配 '+ms.length+' 处:\\n'+ms.map((m,i)=>'#'+(i+1)+' "'+m[0]+'" @'+m.index+(m.length>1?' 分组:['+m.slice(1).join(', ')+']':'')).join('\\n'));
  }catch(e){show('reout','错误:'+e.message,1);}
}

// 编码透视
function xray(){
  const v=$('xin').value; if(!v){show('xout','');return;}
  const bytes=enc.encode(v);
  const uni=Array.from(v).map(c=>'\\\\u'+c.codePointAt(0).toString(16).padStart(4,'0')).join('');
  show('xout','字节数: '+bytes.length+' bytes ('+v.length+' 字符)\\nHex: '+hex(bytes)+'\\nBase64: '+toB64(bytes)+'\\nURL编码: '+encodeURIComponent(v)+'\\nUnicode: '+uni);
}

// 从"节点内容"页面点"解析"跳过来的深链接:?parse=<uri>&back=<来源页地址>
// 自动切到节点解析面板、填好内容并解析,返回链接改成指回来源页而不是通用的后台首页。
// 放在脚本最后执行,这样用到的 $/parseNode/showTool 都已经初始化完毕。
(function(){
  const params = new URLSearchParams(location.search);
  const p = params.get('parse');
  const back = params.get('back');
  if(back){ document.getElementById('back-link').href = back; }
  if(p){
    const el = document.querySelector('.tools-nav a[data-tool="node"]');
    if(el) showTool('node', el);
    $('nodein').value = p;
    parseNode();
  }
})();
</script>`;
}
