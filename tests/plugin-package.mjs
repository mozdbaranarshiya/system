import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root=path.resolve('plugins/system-school');
let checks=0;
async function files(directory){
  const result=[];
  for(const name of await readdir(directory)){
    const file=path.join(directory,name),stat=await lstat(file);
    assert.equal(stat.isSymbolicLink(),false,'Package must not contain symlinks');
    assert.ok(stat.isDirectory()||stat.isFile(),'Package entries must be regular files/directories');
    if(stat.isDirectory())result.push(...await files(file));else result.push(file);
  }
  return result;
}
const entries=await files(root);
assert.equal(entries.some(file=>/[\\/]\.app\.json$|[\\/]\.mcp\.json$/.test(file)),false);checks++;
const manifest=JSON.parse(await readFile(path.join(root,'.codex-plugin/plugin.json'),'utf8'));
assert.equal(manifest.name,'system-school');assert.equal(manifest.skills,'./skills/');
assert.equal(manifest.apps,undefined);assert.equal(manifest.mcpServers,undefined);checks++;
const skill=await readFile(path.join(root,'skills/system-school/SKILL.md'),'utf8');
assert.match(skill,/^---\nname: system-school\ndescription: .+\n---\n/);
assert.match(skill,/Never ask the user to paste any of them/);
assert.match(skill,/Do not assume the uploader\/runtime provides one/);checks++;
assert.equal(await readFile(path.join(root,'references/chatgpt-openapi.yaml'),'utf8'),await readFile('docs/chatgpt-openapi.yaml','utf8'));checks++;
for(const file of entries){
  const text=await readFile(file,'utf8');
  assert.doesNotMatch(text,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|(?:soa_|sor_|soc_|scs_)[A-Za-z0-9_-]{43}/,'No full credentials may be packaged');
  assert.equal(file.startsWith(root+path.sep),true);
}
checks++;
const helper=path.join(root,'skills/system-school/scripts/school_api.py');
const environment={...process.env};delete environment.SYSTEM_SCHOOL_ACCESS_TOKEN;
function cli(args,extra={}){
  const result=spawnSync('python3',['-I','-B',helper,...args],{env:{...environment,...extra},encoding:'utf8'});
  assert.equal(result.error,undefined);
  return result;
}
const missing=cli(['me']);assert.equal(missing.status,1);assert.equal(missing.stdout,'');
assert.equal(JSON.parse(missing.stderr).error,'oauth_binding_required');checks++;
const invalidBinding=cli(['me'],{SYSTEM_SCHOOL_ACCESS_TOKEN:'forbidden-native-session-jwt'});
assert.equal(invalidBinding.status,1);assert.equal(JSON.parse(invalidBinding.stderr).error,'invalid_oauth_binding');
assert.doesNotMatch(invalidBinding.stderr,/forbidden-native-session-jwt/);checks++;
const noArgumentSecret=cli(['me','--access-token','must-not-appear-in-errors']);
assert.equal(noArgumentSecret.status,1);assert.equal(JSON.parse(noArgumentSecret.stderr).error,'invalid_request');
assert.doesNotMatch(noArgumentSecret.stderr,/must-not-appear-in-errors/);checks++;

const python=String.raw`
import contextlib, email.message, importlib.util, io, json, os, ssl, sys, urllib.error, urllib.request, urllib.response
spec=importlib.util.spec_from_file_location('school_plugin_helper',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fake_token='soa_'+'A'*43
os.environ[m.TOKEN_BINDING]=fake_token
uid='00000000-0000-4000-8000-000000000001'
calls=[]
streams=[]
scenario={}
checks=0
original_builder=urllib.request.build_opener
class Stream(io.BytesIO):
    def __init__(self,body): super().__init__(body);self.read_sizes=[]
    def read(self,size=-1): self.read_sizes.append(size);return super().read(size)
class Transport(urllib.request.BaseHandler):
    handler_order=100
    def https_open(self,request):
        calls.append(request)
        if scenario.get('transport_error'):
            raise urllib.error.URLError('hidden-password '+fake_token)
        headers=email.message.Message()
        for key,value in scenario.get('headers',{'Content-Type':'application/json'}).items(): headers[key]=value
        stream=Stream(scenario.get('body',json.dumps({'id':uid,'display_name':'دانش‌آموز'}).encode()))
        streams.append(stream)
        response=urllib.response.addinfourl(stream,headers,request.full_url,scenario.get('status',200))
        response.msg='fixture'
        return response
def builder(*handlers):
    tls=[h for h in handlers if isinstance(h,urllib.request.HTTPSHandler)]
    assert len(tls)==1 and tls[0]._context.verify_mode==ssl.CERT_REQUIRED and tls[0]._context.check_hostname
    assert any(isinstance(h,m.NoRedirect) for h in handlers)
    return original_builder(urllib.request.ProxyHandler({}),Transport(),*handlers)
urllib.request.build_opener=builder
def run(args,expected=None,**values):
    global checks
    scenario.clear();scenario.update(values)
    out,err=io.StringIO(),io.StringIO()
    with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err): rc=m.main(args)
    assert fake_token not in out.getvalue()+err.getvalue()
    assert 'hidden-password' not in out.getvalue()+err.getvalue()
    if expected:
        assert rc==1 and not out.getvalue(),(args,rc,out.getvalue(),err.getvalue())
        assert json.loads(err.getvalue())['error']==expected,(args,err.getvalue())
    else:
        assert rc==0 and not err.getvalue(),(args,rc,err.getvalue())
    checks+=1
    return json.loads(err.getvalue() if expected else out.getvalue())
identity=run(['me'])
assert identity=={'id':uid,'display_name':'دانش‌آموز'}
request=calls[-1]
assert request.full_url==m.BASE_URL+'/api/me' and request.get_method()=='GET' and request.data is None
assert request.get_header('Authorization')=='Bearer '+fake_token
assert request.get_header('Accept')=='application/json'
assert request.timeout==m.TIMEOUT_SECONDS
assert streams[-1].read_sizes==[m.MAX_RESPONSE_BYTES+1]
checks+=1
fixtures={
 'classes':{'id':uid,'title':'کلاس','grade_id':uid,'academic_year':'۱۴۰۵'},
 'grades':{'id':uid,'student_id':uid,'class_id':uid,'subject_id':uid,'period':'first','continuous_score':0,'final_score':None,'lesson_score':19.5},
 'assignments':{'id':uid,'title':'تکلیف','description':'متن مجاز','class_id':uid,'subject_id':uid,'due_at':'2026-10-10T12:00:00Z'},
}
for resource,row in fixtures.items():
    filters=['--class-id',uid,'--student-id',uid,'--limit','1','--offset','0']
    if resource!='classes': filters+=['--subject-id',uid]
    value=run([resource]+filters,body=json.dumps({'rows':[row],'offset':0,'limit':1}).encode())
    assert value=={'rows':[row],'offset':0,'limit':1}
    assert calls[-1].full_url.startswith(m.BASE_URL+'/api/'+resource+'?')
    assert fake_token not in calls[-1].full_url
start=len(calls)
for args in (
 ['../oauth/token'],['https://evil.example'],['me','--url','https://evil.example'],['me','--student-id',uid],
 ['classes','--subject-id',uid],['classes','--limit','0'],['grades','--limit','101'],
 ['assignments','--offset','10001'],['classes','--offset','-1'],['classes','--limit','١'],
 ['classes','--class-id','../../secrets'],['grades','--student-id',uid+'\n'],
 ['classes','--limit','1','--limit=2'],['classes','--lim','1'],['me','--password','hidden-password'],
): run(args,'invalid_request')
assert len(calls)==start
checks+=1
for status in (301,302,303,307,308):
    before=len(calls)
    run(['me'],'redirect_refused',status=status,headers={'Location':'https://evil.example/steal?password=hidden-password'})
    assert len(calls)==before+1 and all(call.full_url.startswith(m.BASE_URL+'/api/') for call in calls)
    assert streams[-1].read_sizes==[]
for status,code in ((400,'invalid_request'),(401,'reconnect_required'),(403,'access_denied'),(429,'rate_limited'),(500,'service_unavailable'),(503,'service_unavailable')):
    run(['me'],code,status=status,body=('hidden-password '+fake_token).encode())
    assert streams[-1].read_sizes==[]
run(['me'],'service_unavailable',transport_error=True)
for headers in (
 {'Content-Type':'text/html'},
 {'Content-Type':'application/json','Content-Encoding':'gzip'},
 {'Content-Type':'application/json','Content-Length':str(m.MAX_RESPONSE_BYTES+1)},
 {'Content-Type':'application/json','Content-Length':'hidden-password'},
):
    run(['me'],'invalid_response',headers=headers)
    assert streams[-1].read_sizes==[]
run(['me'],'invalid_response',body=b'x'*(m.MAX_RESPONSE_BYTES+1))
assert streams[-1].read_sizes==[m.MAX_RESPONSE_BYTES+1]
for body in (b'not-json hidden-password',b'\xff',b'[]',b'null',b'{"id":"bad","display_name":"name"}',json.dumps({'id':uid,'display_name':fake_token}).encode()):
    run(['me'],'invalid_response',body=body)
projected=run(['me'],body=json.dumps({'id':uid,'display_name':'account','password':'hidden-password','access_token':fake_token,'permissions':['admin']}).encode())
assert projected=={'id':uid,'display_name':'account'}
for payload in (
 {'rows':[],'offset':False,'limit':1},
 {'rows':[],'offset':0,'limit':101},
 {'rows':[fixtures['classes'],fixtures['classes']],'offset':0,'limit':1},
 {'rows':[{'id':uid,'title':{'password':'hidden-password'},'grade_id':uid,'academic_year':'1405'}],'offset':0,'limit':1},
): run(['classes'],'invalid_response',body=json.dumps(payload).encode())
try:m.read('me',{'access_token':fake_token})
except m.SafeError as error: assert error.code=='invalid_request'
else:raise AssertionError('Programmatic unexpected query must fail')
checks+=1
print('School plugin helper boundary checks: '+str(checks)+' passed (offline urllib transport fixtures; no production requests).')
`;
const helperTests=spawnSync('python3',['-I','-B','-c',python,helper],{env:environment,encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(helperTests.error,undefined);assert.equal(helperTests.status,0,helperTests.stderr);
process.stdout.write(helperTests.stdout);
console.log(`School plugin package and CLI checks: ${checks} passed.`);

const packaging=String.raw`
import hashlib, importlib.util, io, pathlib, shutil, subprocess, sys, tempfile, zipfile
spec=importlib.util.spec_from_file_location('school_plugin_packager',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.archive(m.SOURCE)
assert original==m.archive(m.SOURCE)
with zipfile.ZipFile(io.BytesIO(original)) as bundle:
    assert bundle.testzip() is None and bundle.namelist()==sorted(m.FILES)
    assert all(bundle.read(name)==(m.SOURCE/name).read_bytes() for name in m.FILES)
    assert all(info.date_time==(1980,1,1,0,0,0) and info.external_attr>>16==0o100644 for info in bundle.infolist())
checks=3
with tempfile.TemporaryDirectory() as folder:
    fixture=pathlib.Path(folder)/'plugin'
    def reset():
        if fixture.exists():shutil.rmtree(fixture)
        shutil.copytree(m.SOURCE,fixture)
    def reject():
        global checks
        try:m.archive(fixture)
        except ValueError:checks+=1
        else:raise AssertionError('Unsafe package must fail closed')
    reset();(fixture/'.env').write_text('unexpected file');reject()
    reset();(fixture/'README.md').unlink();reject()
    reset();(fixture/'README.md').unlink();(fixture/'README.md').symlink_to(m.SOURCE/'README.md');reject()
    reset();(fixture/'README.md').write_text('soa_'+'A'*43);reject()
    reset();(fixture/'.codex-plugin/plugin.json').write_text('{"name":"system-school","skills":"./skills/","apps":["invented-app"]}');reject()
    output=pathlib.Path(folder)/'plugin.zip'
    result=subprocess.run([sys.executable,'-I','-B',sys.argv[1],'--out',str(output)],capture_output=True,text=True)
    assert result.returncode==0 and output.read_bytes()==original;checks+=1
    result=subprocess.run([sys.executable,'-I','-B',sys.argv[1],'--out',str(output)],capture_output=True,text=True)
    assert result.returncode==1 and output.read_bytes()==original;checks+=1
    checkout_output=m.CHECKOUT/'must-not-be-committed.zip'
    result=subprocess.run([sys.executable,'-I','-B',sys.argv[1],'--out',str(checkout_output)],capture_output=True,text=True)
    assert result.returncode==1 and not checkout_output.exists();checks+=1
print('Plugin ZIP integrity and publication-boundary checks: '+str(checks)+' passed.')
`;
const packagingTests=spawnSync('python3',['-I','-B','-c',packaging,path.resolve('plugins/package_school.py')],{env:environment,encoding:'utf8'});
assert.equal(packagingTests.error,undefined);assert.equal(packagingTests.status,0,packagingTests.stderr);
process.stdout.write(packagingTests.stdout);
