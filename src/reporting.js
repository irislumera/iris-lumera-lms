
function completionStatus(row){
  if(row.enrollment_status==="revoked") return "Revoked";
  if(row.enrollment_status==="completed" || row.completed_at) return "Completed";
  const today=new Date().toISOString().slice(0,10);
  if(row.due_at && row.due_at<today) return "Overdue";
  if(row.started_at) return "Started";
  if(row.due_at) return "Pending";
  return "Not Started";
}
function csvCell(v){return String.fromCharCode(34)+String(v==null?"":v).replaceAll(String.fromCharCode(34),String.fromCharCode(34,34))+String.fromCharCode(34)}
export async function learningReport(env,request,authCsrf,json){
  await authCsrf(env,request,"admin");
  const u=new URL(request.url),p=u.searchParams;
  const courseId=p.get("courseId")||"";
  const search=(p.get("search")||"").trim();
  const department=(p.get("department")||"").trim();
  const learnerStatus=p.get("learnerStatus")||"";
  const dateField=p.get("dateField")||"";
  const dateFrom=p.get("dateFrom")||"";
  const dateTo=p.get("dateTo")||"";
  const conditions=[],params=[];
  if(courseId){conditions.push("e.course_id=?");params.push(courseId)}
  if(search){conditions.push("(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR COALESCE(u.employee_id,"") LIKE ? OR c.title LIKE ?)");const q="%"+search+"%";params.push(q,q,q,q,q)}
  if(department){conditions.push("u.department LIKE ?");params.push("%"+department+"%")}
  if(learnerStatus){conditions.push("u.status=?");params.push(learnerStatus)}
  const dateExpr=dateField==="due"?"e.due_at":dateField==="completed"?"substr(e.completed_at,1,10)":dateField==="enrolled"?"substr(e.enrolled_at,1,10)":null;
  if(dateExpr&&dateFrom){conditions.push(dateExpr+">=?");params.push(dateFrom)}
  if(dateExpr&&dateTo){conditions.push(dateExpr+"<=?");params.push(dateTo)}
  const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
  const sql="SELECT e.id,e.status enrollment_status,e.enrolled_at,e.due_at,e.expires_at,e.completed_at,u.first_name,u.last_name,u.email,u.employee_id,u.department,u.status learner_status,c.id course_id,c.title course_title,c.category,c.level,(SELECT MIN(lp.started_at) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=e.user_id AND m.course_id=e.course_id) started_at,(SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=e.course_id AND l.is_required=1) required_count,(SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=e.user_id AND m.course_id=e.course_id AND l.is_required=1 AND lp.completed=1) completed_count,(SELECT ce.id FROM certificates ce WHERE ce.user_id=e.user_id AND ce.course_id=e.course_id LIMIT 1) certificate_id FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id"+where+" ORDER BY e.enrolled_at DESC LIMIT 5000";
  const rows=(await env.DB.prepare(sql).bind(...params).all()).results||[];
  const mapped=rows.map(r=>({...r,progress_pct:Number(r.required_count||0)?Math.round(Number(r.completed_count||0)/Number(r.required_count||1)*100):0,completion_status:completionStatus(r)}));
  const status=p.get("status")||"";
  const filtered=status?mapped.filter(r=>r.completion_status===status):mapped;
  const summary=filtered.reduce((a,r)=>{a.total++;if(r.completion_status==="Completed")a.completed++;else if(r.completion_status==="Started")a.started++;else if(r.completion_status==="Pending")a.pending++;else if(r.completion_status==="Not Started")a.notStarted++;else if(r.completion_status==="Overdue")a.overdue++;else if(r.completion_status==="Revoked")a.revoked++;return a},{total:0,completed:0,started:0,pending:0,notStarted:0,overdue:0,revoked:0});
  if(p.get("format")==="csv"){
    const headers=["Learner Name","Email","Employee ID","Learner Status","Department","Course","Category","Level","Enrollment Date","Started Date","Due Date","Access Expiry","Completion Date","Completion Status","Progress %","Certificate"];
    const lines=[headers,...filtered.map(r=>[r.first_name+" "+r.last_name,r.email,r.employee_id||"",r.learner_status,r.department||"",r.course_title,r.category||"",r.level||"",r.enrolled_at||"",r.started_at||"",r.due_at||"",r.expires_at||"",r.completed_at||"",r.completion_status,r.progress_pct,r.certificate_id?"Issued":""])].map(row=>row.map(csvCell).join(","));
    return new Response(lines.join("\r\n"),{status:200,headers:{"content-type":"text/csv;charset=utf-8","content-disposition":"attachment; filename=\"iris-lumera-learning-report-"+new Date().toISOString().slice(0,10)+".csv\"","cache-control":"no-store"}});
  }
  return json({rows:filtered,summary});
}
