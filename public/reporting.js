
const IRIS_REPORT_STYLE_ID = "iris-report-style";
const IRIS_REPORT_FLAG = "data-iris-enhanced";

const escR = v => String(v == null ? "" : v)
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");
const fmtR = v => v ? new Date(v).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtRT = v => v ? new Date(v).toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";

async function irisGet(url){
  const r = await fetch(url,{credentials:"same-origin",headers:{"Accept":"application/json"}});
  const d = await r.json();
  if(!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

function irisStyle(){
  if(document.getElementById(IRIS_REPORT_STYLE_ID)) return;
  const s=document.createElement("style");
  s.id=IRIS_REPORT_STYLE_ID;
  s.textContent=".iris-filter-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.iris-filter-row .input,.iris-filter-row .select{min-width:150px}.iris-report-table th,.iris-report-table td{white-space:nowrap}.iris-report-note{font-size:11px;color:#7f8698;line-height:1.55}.iris-report-summary{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}.iris-export-actions{display:flex;gap:8px;flex-wrap:wrap}.iris-enhanced-marker{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#eafaf7;color:#157a66;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}";
  document.head.appendChild(s);
}

function enhanceLearnerLearning(){
  const grid=document.querySelector("#my-course-grid") || document.querySelector(".grid-3");
  if(!grid || grid.closest("main")?.querySelector("[data-iris-learning-enhanced]")) return;
  const section=[...document.querySelectorAll(".section")].find(x=>x.querySelector("h2")?.textContent.trim()==="My learning");
  if(!section) return;
  const actual=section.querySelector(".grid-3");
  if(!actual) return;
  const tools=document.createElement("div");
  tools.setAttribute("data-iris-learning-enhanced","1");
  tools.className="iris-filter-row";
  tools.innerHTML="<input id="iris-my-learning-search" class="input search" placeholder="Search my courses...">";
  actual.parentElement.insertBefore(tools,actual);
  const cards=[...actual.querySelectorAll(".course-card")];
  const search=tools.querySelector("input");
  search.addEventListener("input",()=>{
    const q=search.value.trim().toLowerCase();
    let visible=0;
    cards.forEach(card=>{
      const ok=!q || card.textContent.toLowerCase().includes(q);
      card.classList.toggle("hidden",!ok);
      if(ok) visible++;
    });
    let empty=actual.parentElement.querySelector(".iris-my-learning-empty");
    if(!empty){
      empty=document.createElement("div"); empty.className="empty iris-my-learning-empty hidden";
      empty.textContent="No courses match your search.";
      actual.parentElement.appendChild(empty);
    }
    empty.classList.toggle("hidden",visible>0);
  });
}

function enhanceAdminCourses(){
  const search=document.querySelector("#course-search");
  if(!search || search.dataset.irisBound) return;
  search.dataset.irisBound="1";
  const grid=document.querySelector(".admin-main .grid-3");
  if(!grid) return;
  const toolbar=search.closest(".toolbar");
  const status=document.createElement("select");
  status.id="iris-admin-course-status"; status.className="select";
  status.innerHTML="<option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>";
  const level=document.createElement("select");
  level.id="iris-admin-course-level"; level.className="select";
  level.innerHTML="<option value="">All levels</option><option>Foundation</option><option>Intermediate</option><option>Expert</option>";
  toolbar?.querySelector(".toolbar-left")?.append(status,level);
  const filter=()=>{
    const q=search.value.trim().toLowerCase(), st=status.value, lv=level.value;
    grid.querySelectorAll(".course-card").forEach(card=>{
      const txt=card.textContent.toLowerCase();
      const ok=(!q||txt.includes(q))&&(!st||txt.includes(st))&&(!lv||txt.includes(lv.toLowerCase()));
      card.classList.toggle("hidden",!ok);
    });
  };
  search.addEventListener("input",filter); status.addEventListener("change",filter); level.addEventListener("change",filter);
}

function enhanceEnrollmentForm(){
  const form=document.querySelector("#enroll-form");
  if(!form || form.querySelector("[name=dueAt]")) return;
  const wrap=document.createElement("div");
  wrap.innerHTML="<div class="field"><label>Due date</label><input class="input" type="date" name="dueAt"><div class="help">Used for Pending and Overdue reporting. Access expiry remains separate.</div></div>";
  const target=form.querySelector(".wide");
  target ? form.insertBefore(wrap.firstElementChild,target) : form.appendChild(wrap.firstElementChild);
}

function reportParams(){
  const p=new URLSearchParams();
  const map=[["search","iris-report-search"],["courseId","iris-report-course"],["status","iris-report-status"],["learnerStatus","iris-report-learner-status"],["department","iris-report-department"],["dateField","iris-report-date-field"],["dateFrom","iris-report-date-from"],["dateTo","iris-report-date-to"]];
  map.forEach(([key,id])=>{const el=document.getElementById(id);if(el&&el.value)p.set(key,el.value)});
  return p;
}

function reportCsvHref(){const p=reportParams();p.set("format","csv");return "/api/admin/learning-report?"+p.toString()}

async function enhanceAdminReport(panel){
  if(panel.getAttribute(IRIS_REPORT_FLAG)) return;
  panel.setAttribute(IRIS_REPORT_FLAG,"1");
  irisStyle();
  panel.innerHTML="<div class="panel-head"><div><span class="iris-enhanced-marker">Learning analytics</span><h3 style="margin-top:10px">Learning report & exports</h3><p>Detailed learner-course records for compliance, follow-up and management reporting.</p></div><div class="iris-export-actions"><a id="iris-report-csv" class="btn btn-primary" href="/api/admin/learning-report?format=csv" target="_blank" rel="noopener">Download CSV</a><button id="iris-report-reset" class="btn btn-quiet">Reset filters</button></div></div><div class="iris-filter-row"><input id="iris-report-search" class="input search" placeholder="Search learner, email, employee ID or course"><select id="iris-report-course" class="select"><option value="">All courses</option></select><select id="iris-report-status" class="select"><option value="">All completion statuses</option><option>Completed</option><option>Started</option><option>Pending</option><option>Not Started</option><option>Overdue</option><option>Revoked</option></select><select id="iris-report-learner-status" class="select"><option value="">All learner accounts</option><option value="active">Active learners</option><option value="inactive">Inactive learners</option></select><input id="iris-report-department" class="input" placeholder="Department"></div><div class="iris-filter-row"><select id="iris-report-date-field" class="select"><option value="">Date filter</option><option value="enrolled">Enrollment date</option><option value="due">Due date</option><option value="completed">Completion date</option></select><input id="iris-report-date-from" class="input" type="date" aria-label="Date from"><input id="iris-report-date-to" class="input" type="date" aria-label="Date to"></div><div id="iris-report-summary" class="iris-report-summary"></div><div class="iris-report-note" style="margin-bottom:12px">Status logic: Completed = course completed; Overdue = due date passed and incomplete; Started = learner has started but has not completed; Pending = assigned with a due date but not started; Not Started = assigned without a recorded start; Revoked = access removed.</div><div class="table-wrap"><table class="table iris-report-table"><thead><tr><th>Learner</th><th>Email</th><th>Course</th><th>Department</th><th>Enrolled</th><th>Started</th><th>Due</th><th>Completed</th><th>Status</th><th>Progress</th><th>Certificate</th><th>Account</th></tr></thead><tbody id="iris-report-rows"><tr><td colspan="12">Loading...</td></tr></tbody></table></div>";
  const courses=await irisGet("/api/admin/courses");
  const courseEl=document.getElementById("iris-report-course");
  courseEl.innerHTML="<option value="">All courses</option>"+courses.courses.map(x=>"<option value=""+escR(x.id)+"">"+escR(x.title)+"</option>").join("");
  const load=async()=>{
    try{
      const p=reportParams();
      const d=await irisGet("/api/admin/learning-report"+(p.toString()?"?"+p.toString():""));
      const s=d.summary||{};
      document.getElementById("iris-report-summary").innerHTML="<span class="meta-pill">"+Number(s.total||0)+" assignments</span><span class="meta-pill">"+Number(s.completed||0)+" completed</span><span class="meta-pill">"+Number(s.started||0)+" started</span><span class="meta-pill">"+Number(s.pending||0)+" pending</span><span class="meta-pill">"+Number(s.notStarted||0)+" not started</span><span class="meta-pill">"+Number(s.overdue||0)+" overdue</span><span class="meta-pill">"+Number(s.revoked||0)+" revoked</span>";
      document.getElementById("iris-report-rows").innerHTML=(d.rows||[]).map(x=>{
        const cls=x.completion_status==="Completed"?"completed":(x.completion_status==="Overdue"||x.completion_status==="Revoked"?"inactive":"published");
        return "<tr><td><b>"+escR((x.first_name||"")+" "+(x.last_name||""))+"</b><div class="muted tiny">"+escR(x.employee_id||"—")+"</div></td><td>"+escR(x.email)+"</td><td><b>"+escR(x.course_title)+"</b><div class="muted tiny">"+escR(x.category||"")+" · "+escR(x.level||"")+"</div></td><td>"+escR(x.department||"—")+"</td><td>"+fmtRT(x.enrolled_at)+"</td><td>"+fmtRT(x.started_at)+"</td><td>"+fmtR(x.due_at)+"</td><td>"+fmtRT(x.completed_at)+"</td><td><span class="pill "+cls+"">"+escR(x.completion_status)+"</span></td><td>"+Number(x.progress_pct||0)+"%</td><td>"+(x.certificate_id?"Issued":"—")+"</td><td>"+escR(x.learner_status)+"</td></tr>";
      }).join("") || "<tr><td colspan="12">No records match the selected filters.</td></tr>";
      document.getElementById("iris-report-csv").href=reportCsvHref();
    }catch(err){document.getElementById("iris-report-rows").innerHTML="<tr><td colspan="12" class="danger-note">"+escR(err.message)+"</td></tr>"} };
  let timer;
  ["iris-report-search","iris-report-department"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(load,300)}));
  ["iris-report-course","iris-report-status","iris-report-learner-status","iris-report-date-field","iris-report-date-from","iris-report-date-to"].forEach(id=>document.getElementById(id).addEventListener("change",load));
  document.getElementById("iris-report-reset").onclick=()=>{["iris-report-search","iris-report-department","iris-report-date-from","iris-report-date-to"].forEach(id=>document.getElementById(id).value="");["iris-report-course","iris-report-status","iris-report-learner-status","iris-report-date-field"].forEach(id=>document.getElementById(id).value="");load()};
  load();
}

function enhanceAdminPage(){
  const tab=new URLSearchParams(location.search).get("tab");
  if(tab==="courses") enhanceAdminCourses();
  if(tab==="enrollments") enhanceEnrollmentForm();
  if(tab==="reports"){
    const panels=[...document.querySelectorAll(".admin-main .panel")];
    const target=panels.find(p=>p.querySelector("h3")?.textContent.includes("Course") || p.querySelector("table"));
    if(target) enhanceAdminReport(target);
  }
}

function enhance(){
  irisStyle();
  const screen=new URLSearchParams(location.search).get("screen");
  if(screen==="learning") enhanceLearnerLearning();
  if(screen==="admin") enhanceAdminPage();
}

new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
window.addEventListener("popstate",()=>setTimeout(enhance,20));
setTimeout(enhance,100);
