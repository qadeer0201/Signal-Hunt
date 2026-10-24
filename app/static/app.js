const $=s=>document.querySelector(s);let activeCode=sessionStorage.getItem('sh_code')||'';let activeTeam=null;let lastRoute=location.href;let guardStarted=false;
async function api(path,body,headers={}){const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({detail:'Unexpected server response'}));if(!r.ok)throw new Error(d.detail||'Request failed');return d}
function message(t){$('#notice').textContent=t}
function safe(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/register',{name:$('#teamName').value});activeCode=d.code;sessionStorage.setItem('sh_code',activeCode);message(`Team created: ${d.team_name}. SAVE THIS CODE NOW: ${d.code}`);$('#teamCode').value=d.code;await openTeam()}catch(err){message(err.message)}});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();activeCode=$('#teamCode').value.trim();sessionStorage.setItem('sh_code',activeCode);await openTeam()});
async function openTeam(){try{const d=await api('/api/login',{code:activeCode});activeTeam=d.team;message(`Authenticated as ${d.team.name}. Keep this tab open during the challenge.`);renderTeam(d.clues);startGuard()}catch(err){message(err.message);$('#teamArea').hidden=true}}
function renderTeam(clues){const area=$('#teamArea');area.hidden=false;area.innerHTML=`<h3>ACTIVE TEAM // ${safe(activeTeam.name)}</h3><p>Do not use browser Back during the active challenge. Supported Back-navigation attempts trigger team elimination.</p>`+clues.map(c=>`<div class="clue"><b>${safe(c.title)} ${c.solved?'✓ SOLVED':''}</b><p>${safe(c.prompt)}</p>${c.solved?'':`<form data-clue="${c.id}"><input name="answer" required maxlength="500" placeholder="Enter decoded answer"><button class="button" type="submit">SUBMIT</button></form>`}</div>`).join('');area.querySelectorAll('form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/submit',{code:activeCode,clue_id:Number(f.dataset.clue),answer:f.elements.namedItem('answer').value});message(d.message);if(d.correct)await openTeam()}catch(err){message(err.message)}}))}
async function eliminate(kind,details=''){if(!activeCode||!activeTeam||!guardStarted)return;guardStarted=false;try{const d=await api('/api/violation',{code:activeCode,kind,details});$('#teamArea').hidden=false;$('#teamArea').innerHTML=`<h3>TEAM ELIMINATED</h3><p>${safe(d.message)}</p>`;message(d.message)}catch(err){message(`Could not record violation: ${err.message}. Contact an organizer.`)}}
function startGuard(){if(guardStarted)return;guardStarted=true;history.pushState({signalHuntGuard:true},'',location.href);window.addEventListener('popstate',()=>{if(guardStarted){eliminate('back_navigation','Browser Back / history navigation detected');history.pushState({signalHuntGuard:true},'',location.href)}});document.addEventListener('visibilitychange',()=>{if(guardStarted&&document.visibilityState==='hidden'){/* Not auto-eliminated: app switching/backgrounding is unreliable and can be accidental. */}});window.addEventListener('pagehide',()=>{/* Browser close cannot be reliably reported before the page is gone. */});}
$('#adminOpen').addEventListener('click',()=>$('#adminModal').hidden=false);$('#adminClose').addEventListener('click',()=>$('#adminModal').hidden=true);$('#adminLogin').addEventListener('click',loadAdmin);
async function loadAdmin(){
    const pass = $('#adminPass').value;
    try {
        const d = await api('/api/admin/overview', null, {
            'X-Admin-Password': pass
        });

        const area = $('#adminArea');
        area.innerHTML =
            `<h3>TEAMS (${d.teams.length})</h3>` +
            (d.teams.map(t =>
                `<div class="adminlist">#${t.id} ${safe(t.name)} — ` +
                `${t.eliminated ? 'ELIMINATED' : 'ACTIVE'} ` +
                `${t.eliminated ? `<button data-reinstate="${t.id}">REINSTATE</button>` : ''}` +
                `</div>`
            ).join('') || '<p>No teams registered yet.</p>') +

            `<h3>CLUES (${d.clues.length})</h3>` +
            (d.clues.map(c =>
                `<div class="adminlist"><b>#${c.id} ${safe(c.title)}</b> — ` +
                `${c.active ? 'ACTIVE' : 'INACTIVE'}<p>${safe(c.prompt)}</p></div>`
            ).join('') || '<p>No clues added yet.</p>') +

            `<h3>ADD CLUE</h3>
            <form id="addClue">
                <label>TITLE</label>
                <input name="title" minlength="2" maxlength="100" required>
                <label>PROMPT</label>
                <textarea name="prompt" minlength="2" maxlength="2000" required></textarea>
                <label>ANSWER</label>
                <input name="answer" minlength="1" maxlength="200" required>
                <button class="button" type="submit">ADD CLUE</button>
            </form>` +

            `<h3>SUBMISSIONS (${d.submissions.length})</h3>` +
            (d.submissions.map(s =>
                `<div class="adminlist">${safe(s.created_at)} · ` +
                `${safe(s.team)} · ${safe(s.clue)} · ` +
                `${safe(s.answer)} · ${s.correct ? 'CORRECT' : 'INCORRECT'}</div>`
            ).join('') || '<p>No submissions yet.</p>') +

            `<h3>RECENT EVENTS (${d.events.length})</h3>` +
            (d.events.map(x =>
                `<div class="adminlist">${safe(x.created_at)} · ` +
                `${safe(x.team || 'unknown')} · ${safe(x.kind)} · ${safe(x.details)}</div>`
            ).join('') || '<p>No events recorded yet.</p>');

        area.querySelectorAll('[data-reinstate]').forEach(b =>
            b.addEventListener('click', async () => {
                try {
                    await api(`/api/admin/team/${b.dataset.reinstate}/reinstate`,
                        {}, {'X-Admin-Password': pass});
                    await loadAdmin();
                } catch (e) {
                    alert(e.message);
                }
            })
        );

        $('#addClue').addEventListener('submit', async e => {
            e.preventDefault();
            const f = e.target;
            try {
                await api('/api/admin/clues', {
                    title: f.elements.namedItem('title').value,
                    prompt: f.elements.namedItem('prompt').value,
                    answer: f.elements.namedItem('answer').value
                }, {'X-Admin-Password': pass});
                await loadAdmin();
                message('Clue added successfully.');
            } catch (err) {
                alert(err.message);
            }
        });
    } catch (e) {
        $('#adminArea').textContent = e.message;
    }
}
if(activeCode){$('#teamCode').value=activeCode;openTeam()}
