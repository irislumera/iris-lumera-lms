import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectManifest } from '../src/scorm.js';
import { renderCertificateHtml, defaultCertificateConfig } from '../src/certificates.js';
import { readFile } from 'node:fs/promises';

const zipPath = '/tmp/iris-lumera-test-scorm.zip';

async function makeFixture(){
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  await mkdir('/tmp/iris-scorm', {recursive:true});
  await writeFile('/tmp/iris-scorm/imsmanifest.xml', `<?xml version="1.0"?>\n<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"><metadata><schemaversion>1.2</schemaversion></metadata><organizations default="ORG"><organization identifier="ORG"><title>Test Course</title><item identifier="ITEM" identifierref="RES"><title>Test</title></item></organization></organizations><resources><resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources></manifest>`);
  await writeFile('/tmp/iris-scorm/index.html', '<!doctype html><title>SCORM Test</title>');
  await new Promise((resolve,reject)=>execFile('python',['-c',`from zipfile import ZipFile,ZIP_DEFLATED\nwith ZipFile('${zipPath}','w',ZIP_DEFLATED) as z:\n z.write('/tmp/iris-scorm/imsmanifest.xml','imsmanifest.xml')\n z.write('/tmp/iris-scorm/index.html','index.html')`],e=>e?reject(e):resolve()));
}

test('SCORM manifest parser finds a launchable SCO', async()=>{
  await makeFixture();
  const x=await inspectManifest(await readFile(zipPath));
  assert.equal(x.version,'1.2');
  assert.equal(x.title,'Test Course');
  assert.equal(x.launchPath,'index.html');
  assert.deepEqual(Object.keys(x.files).sort(),['imsmanifest.xml','index.html'].sort());
});

test('certificate preserves the learner first and last name', ()=>{
  const html=renderCertificateHtml({snapshot_first_name:'Asha',snapshot_last_name:'Rao',snapshot_course_title:'Human Judgment in the Age of AI',certificate_number:'IL-2026-123456',issued_at:'2026-09-20T00:00:00Z'}, {config_json:JSON.stringify(defaultCertificateConfig())});
  assert.match(html,/Asha Rao/);
  assert.match(html,/Human Judgment in the Age of AI/);
  assert.match(html,/Certificate IL-2026-123456/);
});
