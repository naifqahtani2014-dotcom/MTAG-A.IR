document.getElementById("verifyForm").addEventListener("submit",async e=>{
e.preventDefault();const n=document.getElementById("licenseNo").value.trim();const r=document.getElementById("result");r.innerHTML="جاري التحقق...";
try{const x=await fetch("/api/licenses?q="+encodeURIComponent(n));const d=await x.json();
if(!x.ok){r.innerHTML=`<div class="bad">❌ ${d.error}</div>`;return}
const l=d.license;r.innerHTML=`<div class="result ok"><b>✅ ترخيص صالح</b><div class="certificate license-result"><div class="eyebrow">MTAG LICENSE VERIFICATION</div><div class="num">${l.licenseNumber}</div><div class="certificate-grid"><div><small>المالك</small><br><b>${esc(l.holder)}</b></div><div><small>الشركة</small><br><b>${esc(l.company)}</b></div><div><small>نوع الترخيص</small><br><b>${esc(l.licenseType)}</b></div><div><small>الفئة</small><br><b>${esc(l.category)}</b></div><div><small>الإصدار</small><br><b>${esc(l.issueDate)}</b></div><div><small>الانتهاء</small><br><b>${esc(l.expirationDate||"غير محدد")}</b></div></div></div></div>`;
}catch(e){r.innerHTML='<div class="bad">حدث خطأ أثناء التحقق.</div>'}});
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
