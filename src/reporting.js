function completionStatus(row){
  if(row.enrollment_status==='revoked') return 'Revoked';
  if(row.enrollment_status==='completed' || row.completed_at) return 'Completed';
  const today=new Date().toISOString().slice(0,10);
  if(row.due_at && row.due_at<today) return 'Overdue';
  if(row.started_at) return 'Started';
  if(row.due_at) return 'Pending';
  return 'Not Started';
}

function csvCell(value){
  const q=String.fromCharCode(34);
  return q+String(value==null?'':value).replaceAll(q,q+q)+q;
}

export async function learningReport(env,request,authCsrf,json){
  await authCsrf(env,request,'admin');
  const url=new URL(request.url);
  const p=url.searchParams;
  const courseId=p.get('courseId')||'';
  const search=(p.get('search')||'').trim();
  const department=(p.get('department')||'').trim();
  const learnerStatus=p.get('learnerStatus')||'';
  const dateField=p.get('dateField')||'';
  const dateFrom=p.get('dateFrom')||'';
  const dateTo=p.get('dateTo')||'';
  const statusFilter=p.get('status')||'';
  const conditions=[];
  const params=[];

  if(courseId){conditions.push('e.course_id=?');params.push(courseId);}
  if(search){
    conditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR COALESCE(u.employee_id,\\'\\') LIKE ? OR c.title LIKE ?)');
    const q='%'+search+'%';
    params.push(q,q,q,q,q);
  }
  if(department){conditions.push('u.department LIKE ?');params.push('%'+department+'%');}
  if(learnerStatus){conditions.push('u.status=?');params.push(learnerStatus);}

  const dateExpr=dateField==='due'?'e.due_at':dateField==='completed'?'substr(e.completed_at,1,10)':dateField==='enrolled'?'substr(e.enrolled_at,1,10)':null;
  if(dateExpr&&dateFrom){conditions.push(dateExpr+'>=?');params.push(dateFrom);}
  if(dateExpr&&dateTo){conditions.push(dateExpr+'<=?');params.push(dateTo);}

  const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
  const sql='SELECT e.id,e.status enrollment_status,e.enrolled_at,e.due_at,e.expires_at,e.completed_at,'+
    'u.first_name,u.last_name,u.email,u.employee_id,u.department,u.status learner_status,'+
    'c.id course_id,c.title course_title,c.category,c.level,'+
    '(SELECT MIN(lp.started_at) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=e.user_id AND m.course_id=e.course_id) started_at,'+
    '(SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=e.course_id AND l.is_required=1) required_count,'+
    '(SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=e.user_id AND m.course_id=e.course_id AND l.is_required=1 AND lp.completed=1) completed_count,'+
    '(SELECT ce.id FROM certificates ce WHERE ce.user_id=e.user_id AND ce.course_id=e.course_id LIMIT 1) certificate_id '+
    'FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id'+where+
    ' ORDER BY e.enrolled_at DESC LIMIT 5000';

  const rows=(await env.DB.prepare(sql).bind(...params).all()).results||[];
  const mapped=rows.map(row=>{
    const required=Number(row.required_count||0);
    const completed=Number(row.completed_count||0);
    return {...row,progress_pct:required?Math.round(completed/required*100):0,completion_status:completionStatus(row)};
  });
  const filtered=statusFilter?mapped.filter(row=>row.completion_status===statusFilter):mapped;

  const summary=filtered.reduce((a,row)=>{
    a.total++;
    if(row.completion_status==='Completed')a.completed++;
    else if(row.completion_status==='Started')a.started++;
    else if(row.completion_status==='Pending')a.pending++;
    else if(row.completion_status==='Not Started')a.notStarted++;
    else if(row.completion_status==='Overdue')a.overdue++;
    else if(row.completion_status==='Revoked')a.revoked++;
    return a;
  },{total:0,completed:0,started:0,pending:0,notStarted:0,overdue:0,revoked:0});

  if(p.get('format')==='csv'){
    const headers=['Learner Name','Email','Employee ID','Learner Status','Department','Course','Category','Level','Enrollment Date','Started Date','Due Date','Access Expiry','Completion Date','Completion Status','Progress %','Certificate'];
    const lines=[headers,...filtered.map(row=>[
      row.first_name+' '+row.last_name,row.email,row.employee_id||'',row.learner_status,row.department||'',
      row.course_title,row.category||'',row.level||'',row.enrolled_at||'',row.started_at||'',row.due_at||'',row.expires_at||'',
      row.completed_at||'',row.completion_status,row.progress_pct,row.certificate_id?'Issued':''
    ])].map(row=>row.map(csvCell).join(','));
    const stamp=new Date().toISOString().slice(0,10);
    return new Response(lines.join(String.fromCharCode(13,10)),{
      status:200,
      headers:{
        'content-type':'text/csv;charset=utf-8',
        'content-disposition':'attachment; filename="iris-lumera-learning-report-'+stamp+'.csv"',
        'cache-control':'no-store'
      }
    });
  }
  return json({rows:filtered,summary});
}
