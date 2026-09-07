const OPTIONS={
topic:['曖昧／對方的心意','失戀／斷聯／復合','穩定關係中的問題','單身／桃花／正緣','工作／求職／轉職','人生方向／近期狀態','寵物／離世寵物','只是好奇，想體驗看看','其他'],
source:['Threads','Instagram','Facebook','TikTok','小紅書','LINE','Google 搜尋','朋友分享','其他'],
categoryEase:['很容易找到','找得到，但需要想一下','不太確定該選哪一個','完全找不到適合的分類'],flowClarity:['非常清楚','大致清楚','有些地方看不懂','不知道下一步該做什麼'],
issues:['網站載入速度較慢','按鈕或文字不容易看清楚','不知道不同分類的差異','不知道問題應該怎麼選','抽籤步驟太多','手機版畫面不順','抽籤結果不容易閱讀','找不到想使用的功能','沒有遇到問題','其他'],device:['手機','平板','電腦'],
readability:['很容易理解','大致看得懂','有些內容太抽象','不太知道籤文想表達什麼'],benefits:['更了解自己現在的情緒','看見原本忽略的問題','知道接下來可以怎麼做','得到安慰或被理解的感覺','幫助我重新整理這段關係','讓我暫時放下焦慮','沒有帶來明顯幫助','其他'],
missing:['更具體的行動建議','更清楚的感情／事件走向','更多對方心理的分析','更多對自己狀態的分析','更溫暖的陪伴與安慰','更直接、不拐彎的說法','更完整的前因後果','目前已經足夠','其他'],
free_fortune_remaining_questions:['想更了解對方現在的想法','想知道關係接下來可能怎麼發展','想知道自己下一步可以怎麼做','想更了解目前問題的原因','想知道有哪些值得觀察的訊號','免費籤已經回答得很完整','其他'],
extended_fortune_status:['沒有注意到延伸籤','有看到，但不清楚付費後會得到什麼','有了解內容，但還沒有購買','曾經購買過延伸籤'],
extended_value_clarity:['非常清楚','大致清楚','不太清楚','完全不清楚','沒有看過延伸籤介紹'],
extended_no_purchase_primary_reason:['目前沒有強烈需求','免費籤的內容已經足夠','不清楚付費後會多得到什麼','擔心延伸內容不符合自己的問題','想先多體驗幾次免費抽籤','覺得價格超出預期','不確定付款是否方便或安全','其他'],
extended_buyer_improvement:['內容更符合我當下的問題','對方心理或關係走向可以更具體','下一步建議可以更明確','減少重複或太抽象的文字','內容已經符合期待','其他'],
extended_top_value:['對方現在的想法與心意','關係接下來可能怎麼發展','我下一步可以怎麼做','目前問題真正卡住的原因','哪些訊號代表關係正在改變','其他'],
buyMotivators:['更深入分析對方的心態','提供未來可能的發展','清楚列出接下來的行動建議','根據我的具體問題產生內容','可以繼續追問一個問題','提供真人占卜師解讀','先看到部分延伸內容預覽','其他'],wantedFeatures:['更多愛情與曖昧題目','斷聯／復合專區','關係狀態檢測','每週感情運勢','真人文字占卜','收藏過去抽到的籤','抽籤紀錄與關係變化追蹤','匿名分享自己的故事','工作／轉職相關內容','寵物與離世寵物內容','其他'],
returnIntent:['會，遇到事情就會想來抽一支','會，但可能隔一段時間','不確定，看當下心情','應該不會再回來'],
age:['18 歲以下','18～24 歲','25～30 歲','31～35 歲','36～40 歲','41 歲以上','不方便回答'],relationship:['單身','有喜歡或曖昧的對象','穩定交往中','遠距離關係','剛分手／斷聯','已婚','關係狀態較複雜','不方便回答']};
document.querySelectorAll('[data-name]').forEach(box=>{const name=box.dataset.name;if(box.classList.contains('scale')){box.innerHTML=`<small>${box.dataset.left}</small>`+[1,2,3,4,5].map(v=>`<label><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`).join('')+`<small>${box.dataset.right}</small>`;return}const check=box.classList.contains('checks');box.innerHTML=(OPTIONS[name]||[]).map((v,i)=>`<label><input type="${check?'checkbox':'radio'}" name="${name}" value="${v}"><span>${v}</span></label>`).join('')});
/* 第 12 題的分流。買過的人問「買了之後想改善什麼」，沒買的人問「為什麼還沒買」。
   切換分支時要把另一邊已經勾的答案清掉——不清的話，先答了未購買原因、
   再改成「曾經購買過」，兩邊的答案都會被送出，資料自相矛盾。 */
const branches=[...document.querySelectorAll('[data-branch]')];
function applyBranch(){
  const picked=document.querySelector('[name="extended_fortune_status"]:checked');
  const want=picked?(picked.value==='曾經購買過延伸籤'?'buyer':'nobuy'):null;
  branches.forEach(fs=>{
    const on=fs.dataset.branch===want;
    fs.hidden=!on;
    if(!on)fs.querySelectorAll('input').forEach(i=>{i.checked=false;});
  });
}
document.addEventListener('change',e=>{
  if(e.target&&e.target.name==='extended_fortune_status')applyBranch();
});

let step=1;const steps=[...document.querySelectorAll('.sv-step')],err=document.getElementById('formError');function show(){steps.forEach((s,i)=>s.classList.toggle('active',i===step-1));document.getElementById('prevBtn').style.visibility=step===1?'hidden':'visible';document.getElementById('nextBtn').style.display=step===4?'none':'inline-flex';document.getElementById('submitBtn').style.display=step===4?'inline-flex':'none';document.getElementById('progressBar').style.width=(step*25)+'%';document.getElementById('progressText').textContent=`第 ${step}／4 部分`;err.textContent='';scrollTo({top:0,behavior:'smooth'})}function valid(){const seen=new Set();for(const b of steps[step-1].querySelectorAll('legend b')){const fs=b.closest('fieldset');if(!fs||seen.has(fs))continue;seen.add(fs);const first=fs.querySelector('[name]');if(!first)continue;const group=[...fs.querySelectorAll(`[name="${first.name}"]`)],choices=group.filter(el=>el.type==='radio'||el.type==='checkbox');let ok,bad=null;if(choices.length){ok=choices.some(el=>el.checked)}else{const filled=group.filter(el=>(el.value||'').trim()!=='');bad=filled.find(el=>!el.checkValidity())||null;ok=filled.length>0&&!bad}if(!ok){const label=(fs.querySelector('legend')?.textContent||'').replace(/[*＊]/g,'').trim();err.textContent=bad?`「${label}」格式不正確。`:(label?`請先完成：${label}`:'請先完成這一頁的必填題目。');first.focus();return false}}return true}document.getElementById('nextBtn').onclick=()=>{if(valid()){step++;show()}};document.getElementById('prevBtn').onclick=()=>{step--;show()};document.querySelectorAll('[data-max]').forEach(box=>box.addEventListener('change',e=>{const max=+box.dataset.max,checked=box.querySelectorAll('input:checked');if(checked.length>max){e.target.checked=false;err.textContent=`這題最多選 ${max} 項。`}}));
document.getElementById('surveyForm').addEventListener('submit',async e=>{e.preventDefault();if(!valid())return;const btn=document.getElementById('submitBtn');btn.disabled=true;btn.textContent='正在送出…';const fd=new FormData(e.target),data={};for(const [k,v] of fd){if(['issues','benefits','missing','noBuyReasons','buyMotivators','wantedFeatures','free_fortune_remaining_questions','extended_buyer_improvement'].includes(k)){(data[k]||(data[k]=[])).push(v)}else data[k]=v}try{const r=await fetch('/api/survey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'送出失敗');location.href='/survey/thanks/?token='+encodeURIComponent(d.rewardToken)}catch(x){err.textContent=x.message||'目前無法送出，請稍後再試。';btn.disabled=false;btn.textContent='送出並取得限定籤 →'}});applyBranch();show();
