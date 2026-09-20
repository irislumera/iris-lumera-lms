(() => {
  const STYLE_ID='iris-enhancements-style';
  const bound=new WeakSet();

  function style(){
    if(document.getElementById(STYLE_ID)) return;
    const s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent='.iris-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}.iris-tools .input,.iris-tools .select{min-width:150px}.iris-summary{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}.iris-note{font-size:11px;color:#7f8698;line-height:1.55;margin:0 0 12px}.iris-report-table th,.iris-report-table td{white-space:nowrap}.iris-actions{display:flex;gap:8px;flex-wrap:wrap}';
    document.head.appendChild(s);
  }
  function esc(v){
    return String(v==null?'':v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
  }
  function date(v){return v?new Date(v).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—'}
  function dateTime(v){return v?new Date(v).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}
  async function get(url){
    const r=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Request failed');
    return d;
  }
  function addLearnerSearch(){
    const sections=[...document.querySelectorAll('.section')];
    const section=sections.find(x=>(x.querySelector('h2')?.textContent||'').trim()==='My learning');
    if(!section)return;
    const grid=section.querySelector('.grid-3');
    if(!grid||grid.previousElementSibling?.dataset?.irisLearnerSearch)return;
    const bar=document.createElement('div');
    bar.className='iris-tools';
    bar.dataset.irisLearnerSearch='1';
    bar.innerHTML='<input id="iris-learning-search" class="input search" placeholder="Search my courses...">';
    grid.parentElement.insertBefore(bar,grid);
    const input=bar.querySelector('#iris-learning-search');
    const cards=[...grid.querySelectorAll('.course-card')];
    let empty=null;
    input.addEventListener('input',()=>{
      const q=input.value.trim().toLowerCase();
      let visible=0;
      cards.forEach(card=>{
        const ok=!q||card.textContent.toLowerCase().includes(q);
        card.classList.toggle('hidden',!ok);
        if(ok)visible++;
      });
      if(!empty){empty=document.createElement('div');empty.className='empty iris-learning-empty hidden';empty.textContent='No courses match your search.';grid.parentElement.appendChild(empty);}
      empty.classList.toggle('hidden',visible>0);
    });
  }
  function addCourseFilters(){
    const search=document.querySelector('#course-search');
    if(!search||bound.has(search))return;
    const grid=document.querySelector('.admin-main .grid-3');
    const left=search.closest('.toolbar')?.querySelector('.toolbar-left');
    if(!grid||!left)return;
    bound.add(search);
    const status=document.createElement('select');
    status.className='select';status.innerHTML='<option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>';
    const level=document.createElement('select');
    level.className='select';level.innerHTML='<option value="">All levels</option><option>Foundation</option><option>Intermediate</option><option>Expert</option>';
    left.append(status,level);
    const apply=()=>{
      const q=search.value.trim().toLowerCase();
      grid.querySelectorAll('.course-card').forEach(card=>{
        const txt=card.textContent.toLowerCase();
        const ok=(!q||txt.includes(q))&&(!status.value||txt.includes(status.value))&&(!level.value||txt.includes(level.value.toLowerCase()));
        card.classList.toggle('hidden',!ok);
      });
    };
    search.addEventListener('input',apply);status.addEventListener('change',apply);level.addEventListener('change',apply);
  }
  function addDueDate(){
    const form=document.querySelector('#enroll-form');
    if(!form||form.querySelector('[name=dueAt]'))return;
    const box=document.createElement('div');
    box.className='field';
    box.innerHTML='<label>Due date</label><input class="input" type="date" name="dueAt"><div class="help">Used for pending and overdue tracking. Access expiry is separate.</div>';
    const wide=form.querySelector('.wide');
    if(wide)form.insertBefore(box,wide);else form.appendChild(box);
  }
  function params(){
    const p=new URLSearchParams();
    [['search','iris-report-search'],['courseId','iris-report-course'],['status','iris-report-status'],['learnerStatus','iris-report-learner-status'],['department','iris-report-department'],['dateField','iris-report-date-field'],['dateFrom','iris-report-date-from'],['dateTo','iris-report-date-to']].forEach(pair=>{
      const v=document.getElementById(pair[1])?.value||'';if(v)p.set(pair[0],v);
    });
    return p;
  }
  async function renderReports(panel){
    if(!panel||bound.has(panel))return;
    bound.add(panel);style();
    panel.innerHTML='<div class="panel-head"><div><h3>Learning report & exports</h3><p>One row per learner-course assignment with email, course, dates, due date, completion status and progress.</p></div><div class="iris-actions"><a id="iris-report-csv" class="btn btn-primary" target="_blank" rel="noopener">Download CSV</a><button id="iris-report-reset" class="btn btn-quiet">Reset filters</button></div></div>'+
      '<div class="iris-tools"><input id="iris-report-search" class="input search" placeholder="Search learner, email, employee ID or course"><select id="iris-report-course" class="select"><option value="">All courses</option></select><select id="iris-report-status" class="select"><option value="">All completion statuses</option><option>Completed</option><option>Started</option><option>Pending</option><option>Not Started</option><option>Overdue</option><option>Revoked</option></select><select id="iris-report-learner-status" class="select"><option value="">All learner accounts</option><option value="active">Active learners</option><option value="inactive">Inactive learners</option></select><input id="iris-report-department" class="input" placeholder="Department"></div>'+
      '<div class="iris-tools"><select id="iris-report-date-field" class="select"><option value="">Date filter</option><option value="enrolled">Enrollment date</option><option value="due">Due date</option><option value="completed">Completion date</option></select><input id="iris-report-date-from" class="input" type="date" aria-label="Date from"><input id="iris-report-date-to" class="input" type="date" aria-label="Date to"></div>'+
      '<div id="iris-report-summary" class="iris-summary"></div><p class="iris-note"><b>Status:</b> Completed = course completed. Started = learner has started but is not complete. Pending = assigned with a due date and not started. Not Started = assigned with no recorded start and no due date. Overdue = due date passed and incomplete. Revoked = access removed.</p>'+
      '<div class="table-wrap"><table class="table iris-report-table"><thead><tr><th>Learner</th><th>Email</th><th>Course</th><th>Department</th><th>Enrolled</th><th>Started</th><th>Due</th><th>Completed</th><th>Status</th><th>Progress</th><th>Certificate</th><th>Account</th></tr></thead><tbody id="iris-report-rows"><tr><td colspan="12">Loading...</td></tr></tbody></table></div>';

    const courses=await get('/api/admin/courses');
    const courseSel=document.querySelector('#iris-report-course');
    courseSel.innerHTML='<option value="">All courses</option>'+courses.courses.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join('');

    const load=async()=>{
      try{
        const p=params();
        const d=await get('/api/admin/learning-report'+(p.toString()?'?'+p.toString():''));
        const s=d.summary||{};
        document.querySelector('#iris-report-summary').innerHTML='<span class="meta-pill">'+Number(s.total||0)+' assignments</span><span class="meta-pill">'+Number(s.completed||0)+' completed</span><span class="meta-pill">'+Number(s.started||0)+' started</span><span class="meta-pill">'+Number(s.pending||0)+' pending</span><span class="meta-pill">'+Number(s.notStarted||0)+' not started</span><span class="meta-pill">'+Number(s.overdue||0)+' overdue</span><span class="meta-pill">'+Number(s.revoked||0)+' revoked</span>';
        document.querySelector('#iris-report-rows').innerHTML=(d.rows||[]).map(x=>{
          const cls=x.completion_status==='Completed'?'completed':(x.completion_status==='Overdue'||x.completion_status==='Revoked'?'inactive':'published');
          return '<tr><td><b>'+esc((x.first_name||'')+' '+(x.last_name||''))+'</b><div class="muted tiny">'+esc(x.employee_id||'—')+'</div></td><td>'+esc(x.email)+'</td><td><b>'+esc(x.course_title)+'</b><div class="muted tiny">'+esc(x.category||'')+' · '+esc(x.level||'')+'</div></td><td>'+esc(x.department||'—')+'</td><td>'+dateTime(x.enrolled_at)+'</td><td>'+dateTime(x.started_at)+'</td><td>'+date(x.due_at)+'</td><td>'+dateTime(x.completed_at)+'</td><td><span class="pill '+cls+'">'+esc(x.completion_status)+'</span></td><td>'+Number(x.progress_pct||0)+'%</td><td>'+(x.certificate_id?'Issued':'—')+'</td><td>'+esc(x.learner_status)+'</td></tr>';
        }).join('')||'<tr><td colspan="12">No records match the selected filters.</td></tr>';
        const csv=params();csv.set('format','csv');document.querySelector('#iris-report-csv').href='/api/admin/learning-report?'+csv.toString();
      }catch(err){
        document.querySelector('#iris-report-rows').innerHTML='<tr><td colspan="12" class="danger-note">'+esc(err.message)+'</td></tr>';
      }
    };
    let timer=0;
    ['iris-report-search','iris-report-department'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,300)}));
    ['iris-report-course','iris-report-status','iris-report-learner-status','iris-report-date-field','iris-report-date-from','iris-report-date-to'].forEach(id=>document.getElementById(id).addEventListener('change',load));
    document.getElementById('iris-report-reset').onclick=()=>{
      ['iris-report-search','iris-report-department','iris-report-date-from','iris-report-date-to'].forEach(id=>document.getElementById(id).value='');
      ['iris-report-course','iris-report-status','iris-report-learner-status','iris-report-date-field'].forEach(id=>document.getElementById(id).value='');
      load();
    };
    load();
  }
  function enhance(){
    style();
    const screen=new URLSearchParams(location.search).get('screen');
    if(screen==='learning')addLearnerSearch();
    if(screen==='admin'){
      const tab=new URLSearchParams(location.search).get('tab');
      if(tab==='courses')addCourseFilters();
      if(tab==='enrollments')addDueDate();
      if(tab==='reports'){
        const panel=[...document.querySelectorAll('.admin-main .panel')].find(x=>x.querySelector('table'));
        if(panel)renderReports(panel);
      }
    }
  }
  const observer=new MutationObserver(enhance);
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>setTimeout(enhance,20));
  setTimeout(enhance,120);
})();