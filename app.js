(function () {
  const STORAGE_KEY = 'meu_cuidado_v3';
  const DEFAULT_GAS = 'https://script.google.com/macros/s/AKfycbzBboHCuLaPbyI6BliNEpWalWmcTC_4KgyM3Ua44GZbe46EQrnBP50Yteep-UQtFPOTWA/exec';

  const defaultState = {
    configured: false,
    userName: '',
    userEmail: '',
    userAvatar: '',
    supportPhone: '',
    supportEmail: '',
    allergies: '',
    sensoryMode: 'soft',
    voiceRate: 0.95,
    requireQr: false,
    requirePhoto: false,
    continuousVoice: false,
    googleClientId: '400634410081-usp328ku7tm6aeu9pmu494k0te0h4h7r.apps.googleusercontent.com',
    gasUrl: DEFAULT_GAS,
    waterCount: 0,
    lastCheckin: '',
    medications: [
      { id: 'm1', name: 'Losartana', dosage: '50mg (1 comp.)', time: '08:00', stock: 18, takenToday: false, takenAt: '' },
      { id: 'm2', name: 'Metformina', dosage: '850mg (1 comp.)', time: '12:30', stock: 12, takenToday: false, takenAt: '' }
    ],
    vitals: [
      { id: 'v1', date: '14/11 08:00', sys: 120, dia: 80, glucose: '', status: 'Normal' }
    ],
    appointments: []
  };

  let state = loadState();
  let bpChart = null;
  let activeConfirmId = null;
  let countdownTimer = null;
  let qrStream = null;
  let qrValidated = false;
  let photoAttached = false;
  let deferredInstall = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, defaultState, JSON.parse(raw));
    } catch (e) {}
    return JSON.parse(JSON.stringify(defaultState));
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  function speak(text, autoListenAfter) {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'pt-BR';
        u.rate = Number(state.voiceRate) || 0.95;
        if (autoListenAfter && state.continuousVoice) {
          u.onend = () => { try { startVoice(); } catch (e) {} };
        }
        window.speechSynthesis.speak(u);
      }
    } catch (e) {}
  }

  async function sync(action, payload) {
    if (!state.gasUrl || !state.gasUrl.startsWith('https://')) return;
    const st = document.getElementById('syncStatus');
    try {
      if (st) st.textContent = 'Sincronizando...';
      await fetch(state.gasUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action,
          userName: state.userName || 'Usuário',
          elderName: state.userName || 'Usuário',
          caregiverEmail: state.supportEmail,
          payload
        })
      });
      if (st) st.textContent = 'Sincronizado às ' + new Date().toLocaleTimeString('pt-BR');
    } catch (e) {
      if (st) st.textContent = 'Salvo localmente (sem conexão)';
    }
  }

  // ---- Google Sign-In ----
  function decodeJwt(token) {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  }

  function initGoogleSignIn() {
    const cid = state.googleClientId || '400634410081-usp328ku7tm6aeu9pmu494k0te0h4h7r.apps.googleusercontent.com';
    if (typeof google === 'undefined' || !google.accounts) { setTimeout(initGoogleSignIn, 500); return; }
    try {
      google.accounts.id.initialize({
        client_id: cid,
        callback: (res) => {
          const info = decodeJwt(res.credential);
          state.userName = info.name || state.userName;
          state.userEmail = info.email || '';
          state.userAvatar = info.picture || '';
          document.getElementById('setupName').value = state.userName;
          document.getElementById('googleName').textContent = state.userName;
          document.getElementById('googleEmail').textContent = state.userEmail;
          document.getElementById('googleAvatar').src = state.userAvatar;
          document.getElementById('googleUserBadge').classList.remove('hidden');
          saveState();
          toast('Conta Google conectada!');
        }
      });
      google.accounts.id.renderButton(document.getElementById('googleBtnContainer'), { theme: 'outline', size: 'large', width: 300 });
    } catch (e) {}
  }

  // ---- Setup Screen ----
  function showSetup() {
    document.getElementById('setupScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('setupName').value = state.userName || '';
    document.getElementById('setupSupportPhone').value = state.supportPhone || '';
    document.getElementById('setupSupportEmail').value = state.supportEmail || '';
    initGoogleSignIn();
  }

  function enterApp(withVoice) {
    const n = document.getElementById('setupName').value.trim();
    const ph = document.getElementById('setupSupportPhone').value.trim();
    const em = document.getElementById('setupSupportEmail').value.trim();
    if (n) state.userName = n;
    if (ph) state.supportPhone = ph;
    if (em) state.supportEmail = em;
    if (!state.userName) { toast('Informe seu nome para começar.'); return; }
    state.configured = true;
    saveState();
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    renderAll();
    if (withVoice) speak(`Olá ${state.userName}. Estou pronto para ajudar.`, true);
  }

  // ---- Sensory & Visual ----
  function applyVisualProfile() {
    document.body.classList.toggle('low-vision', state.sensoryMode === 'lowvision');
    const box = document.getElementById('confirmBox');
    if (box) {
      box.classList.toggle('alert-high', state.sensoryMode === 'high');
      box.classList.toggle('border-rose-600', state.sensoryMode === 'high');
      box.classList.toggle('border-teal-600', state.sensoryMode !== 'high');
    }
  }

  // ---- Tabs ----
  function switchTab(tabId) {
    ['viewHome', 'viewSupport', 'viewConfig'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== tabId);
    });
    document.querySelectorAll('.nav-tab').forEach(btn => {
      const active = btn.getAttribute('data-tab') === tabId;
      btn.className = active
        ? 'nav-tab px-3 py-1.5 rounded-lg font-semibold bg-white text-slate-900 shadow-sm'
        : 'nav-tab px-3 py-1.5 rounded-lg font-medium text-slate-600';
    });
    if (tabId === 'viewSupport') renderChart();
    if (tabId === 'viewConfig') {
      document.getElementById('cfgName').value = state.userName || '';
      document.getElementById('cfgPhone').value = state.supportPhone || '';
      document.getElementById('cfgEmail').value = state.supportEmail || '';
      document.getElementById('cfgAllergies').value = state.allergies || '';
      document.getElementById('cfgMode').value = state.sensoryMode || 'soft';
      document.getElementById('cfgRate').value = String(state.voiceRate || 0.95);
      document.getElementById('cfgReqQr').checked = !!state.requireQr;
      document.getElementById('cfgReqPhoto').checked = !!state.requirePhoto;
      document.getElementById('cfgContVoice').checked = !!state.continuousVoice;
          }
  }

  // ---- Render ----
  function renderAll() {
    applyVisualProfile();
    document.getElementById('headerUserLabel').textContent = state.userEmail || state.userName || 'Saúde & Rotinas';
    document.getElementById('waterCount').textContent = state.waterCount || 0;

    const telHref = state.supportPhone ? `tel:${state.supportPhone.replace(/\D/g, '')}` : 'tel:';
    document.getElementById('linkCallSupport').href = telHref;
    document.getElementById('linkCallSupport2').href = telHref;

    const sorted = [...state.medications].sort((a, b) => a.time.localeCompare(b.time));
    const pending = sorted.filter(m => !m.takenToday);
    const doneCount = sorted.length - pending.length;
    const pct = sorted.length ? Math.round((doneCount / sorted.length) * 100) : 0;
    document.getElementById('progressText').textContent = `${doneCount}/${sorted.length} (${pct}%)`;

    // Card "Agora"
    const nowC = document.getElementById('nowCardContent');
    const nowA = document.getElementById('nowCardActions');
    if (pending.length) {
      const next = pending[0];
      nowC.innerHTML = `<p class="text-teal-800 font-bold">${next.time} — Tomar ${next.name} (${next.dosage})</p><p class="text-xs text-slate-500 mt-1">Passo a passo: 1. Pegue 1 copo de água • 2. Tome a dose • 3. Confirme abaixo.</p>`;
      nowA.innerHTML = `<button data-open-confirm="${next.id}" class="lv-btn flex-1 py-3 px-4 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl text-sm">Iniciar Confirmação</button>`;
    } else {
      nowC.innerHTML = `<p class="text-emerald-700 font-bold">Tudo confirmado por enquanto hoje.</p>`;
      nowA.innerHTML = '';
    }

    // Lista Agenda
    const list = document.getElementById('medList');
    list.innerHTML = '';
    sorted.forEach(m => {
      const row = document.createElement('div');
      row.className = `p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${m.takenToday ? 'bg-emerald-50/70 border-emerald-200' : 'bg-white border-slate-200'}`;
      row.innerHTML = `
        <div>
          <p class="font-bold text-slate-900 text-sm"><span class="text-teal-700 mr-2">${m.time}</span>${m.name}</p>
          <p class="text-xs text-slate-500">${m.dosage} • Estoque: ${m.stock} un.</p>
        </div>
        <div>
          ${m.takenToday
            ? `<span class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">Confirmado (${m.takenAt})</span>`
            : `<button data-open-confirm="${m.id}" class="px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold">Confirmar</button>`
          }
        </div>
      `;
      list.appendChild(row);
    });

    // KPIs Rede de Apoio
    document.getElementById('kpiAdh').textContent = pct + '%';
    document.getElementById('kpiPend').textContent = String(pending.length);
    document.getElementById('kpiCheckin').textContent = state.lastCheckin || 'Pendente';
    const lastV = state.vitals[state.vitals.length - 1];
    document.getElementById('kpiBP').textContent = lastV ? `${lastV.sys}/${lastV.dia}` : '--/--';

    // Etiquetas QR Code
    const qrBox = document.getElementById('qrLabelsList');
    qrBox.innerHTML = '';
    sorted.forEach(m => {
      const code = `MEUCUIDADO:${m.id}:${m.name}`;
      const div = document.createElement('div');
      div.className = 'p-3 rounded-xl border border-slate-200 flex items-center gap-3 bg-slate-50';
      div.innerHTML = `
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(code)}" alt="QR ${m.name}" class="w-20 h-20 rounded bg-white p-1 border" />
        <div class="text-xs"><p class="font-bold text-slate-900">${m.name}</p><p class="text-slate-600">${m.dosage} • ${m.time}</p><p class="text-slate-400 mt-1">Cole na caixa</p></div>
      `;
      qrBox.appendChild(div);
    });

    // Consultas
    const apptEl = document.getElementById('apptList');
    apptEl.innerHTML = state.appointments.length ? '' : '<p class="text-xs text-slate-400">Nenhuma consulta agendada.</p>';
    state.appointments.forEach(a => {
      const d = document.createElement('div');
      d.className = 'p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex justify-between items-center';
      d.innerHTML = `<span><strong>${a.doctor}</strong> — ${a.date} às ${a.time}</span><button data-del-appt="${a.id}" class="text-xs text-rose-600 font-medium">Remover</button>`;
      apptEl.appendChild(d);
    });

    // Cartão de Emergência
    document.getElementById('ecName').textContent = state.userName || '-';
    document.getElementById('ecAllergies').textContent = state.allergies || 'Nenhuma informada';
    document.getElementById('ecMeds').textContent = sorted.map(m => `${m.name} (${m.dosage} às ${m.time})`).join(', ') || '-';
    document.getElementById('ecBP').textContent = lastV ? `${lastV.sys}/${lastV.dia}` : '--/--';
    document.getElementById('ecPhone').textContent = state.supportPhone || 'Não cadastrado';
  }

  function renderChart() {
    try {
      if (typeof Chart === 'undefined') return;
      const canvas = document.getElementById('bpChart');
      if (!canvas) return;
      if (bpChart) bpChart.destroy();
      bpChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: state.vitals.map(v => v.date),
          datasets: [
            { label: 'Sistólica', data: state.vitals.map(v => v.sys), borderColor: '#0F766E', tension: 0.3 },
            { label: 'Diastólica', data: state.vitals.map(v => v.dia), borderColor: '#64748B', tension: 0.3 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 50, max: 190 } } }
      });
    } catch (e) {}
  }

  // ---- Fluxo de Confirmação em 2 Tempos + QR + Foto ----
  function stopCamera() {
    if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  }

  function openConfirmFlow(id) {
    const m = state.medications.find(x => x.id === id);
    if (!m) return;
    activeConfirmId = id;
    qrValidated = !state.requireQr;
    photoAttached = !state.requirePhoto;

    document.getElementById('cmMedName').textContent = `${m.name} (${m.dosage})`;
    document.getElementById('cmMedInfo').textContent = `Horário programado: ${m.time}`;
    document.getElementById('cmStep1').classList.remove('hidden');
    document.getElementById('cmStep2').classList.add('hidden');
    document.getElementById('confirmModal').classList.remove('hidden');
    speak(`Hora de tomar ${m.name}, ${m.dosage}. Toque em estou indo pegar.`);
  }

  function checkCanFinishConfirm(secondsLeft) {
    const ok = secondsLeft <= 0 && qrValidated && photoAttached;
    document.getElementById('btnCmFinal').disabled = !ok;
  }

  function startStep2() {
    document.getElementById('cmStep1').classList.add('hidden');
    document.getElementById('cmStep2').classList.remove('hidden');
    document.getElementById('cmQrBox').classList.toggle('hidden', !state.requireQr);
    document.getElementById('cmPhotoBox').classList.toggle('hidden', !state.requirePhoto);
    document.getElementById('photoStatus').textContent = 'Nenhuma foto anexada.';

    let sec = 15;
    document.getElementById('cmCountdown').textContent = sec;
    document.getElementById('cmTimerBox').classList.remove('hidden');
    checkCanFinishConfirm(sec);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      sec--;
      document.getElementById('cmCountdown').textContent = Math.max(0, sec);
      if (sec <= 0) {
        clearInterval(countdownTimer);
        document.getElementById('cmTimerBox').classList.add('hidden');
      }
      checkCanFinishConfirm(sec);
    }, 1000);

    if (state.requireQr) startQrScanner(sec);
  }

  async function startQrScanner() {
    const statusEl = document.getElementById('qrStatus');
    const video = document.getElementById('qrVideo');
    try {
      qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = qrStream;
      await video.play();
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const scan = async () => {
          if (qrValidated || !qrStream) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue.includes('MEUCUIDADO:')) {
              qrValidated = true;
              statusEl.textContent = 'QR Code validado com sucesso!';
              stopCamera();
              checkCanFinishConfirm(Number(document.getElementById('cmCountdown').textContent) || 0);
              return;
            }
          } catch (e) {}
          requestAnimationFrame(scan);
        };
        scan();
      } else {
        qrValidated = true;
        statusEl.textContent = 'Leitor nativo indisponível neste navegador — liberado após contagem.';
      }
    } catch (e) {
      qrValidated = true;
      statusEl.textContent = 'Câmera indisponível — liberado após contagem.';
    }
  }

  function finalizeConfirm() {
    stopCamera();
    if (countdownTimer) clearInterval(countdownTimer);
    const m = state.medications.find(x => x.id === activeConfirmId);
    if (!m) return;
    m.takenToday = true;
    m.takenAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (m.stock > 0) m.stock -= 1;
    saveState();
    sync('confirm_dose', m);
    document.getElementById('confirmModal').classList.add('hidden');
    renderAll();
    toast(`${m.name} confirmado!`);
    speak(`Muito bem! ${m.name} registrado.`);
  }

  // ---- Sinais Vitais ----
  function saveVitals(rawSys, rawDia, rawGlu, origem) {
    let sys = parseInt(rawSys, 10), dia = parseInt(rawDia, 10);
    const glu = rawGlu ? parseInt(rawGlu, 10) : '';
    if (isNaN(sys) || isNaN(dia)) { toast('Informe máxima e mínima da pressão.'); return; }
    if (sys < 30) sys *= 10;
    if (dia < 20) dia *= 10;
    const status = (sys >= 140 || dia >= 90) ? 'Crítico' : (sys >= 130 || dia >= 85 ? 'Atenção' : 'Normal');
    const entry = { id: 'v' + Date.now(), date: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), sys, dia, glucose: glu, status, origem };
    state.vitals.push(entry);
    saveState();
    sync('add_vitals', entry);
    document.getElementById('inSys').value = '';
    document.getElementById('inDia').value = '';
    document.getElementById('inGlucose').value = '';
    renderAll();
    toast(`Pressão ${sys}x${dia} (${status}) registrada.`);
    speak(`Pressão ${sys} por ${dia} salva.`);
  }

  // ---- Voz ----
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Microfone não suportado neste navegador.'); return; }
    const btn = document.getElementById('btnVoice');
    const lbl = document.getElementById('voiceLabel');
    const rec = new SR();
    rec.lang = 'pt-BR';
    btn.classList.add('mic-active');
    lbl.textContent = 'Ouvindo... pode falar';
    rec.onresult = (e) => {
      const txt = e.results[0][0].transcript;
      const box = document.getElementById('voiceBox');
      box.classList.remove('hidden');
      const lower = txt.toLowerCase();
      const bp = lower.match(/(\d{2,3})\s*(?:por|x|\/|e)\s*(\d{1,3})/);
      if (bp) {
        saveVitals(bp[1], bp[2], '', 'Voz');
        box.textContent = `"${txt}" → Pressão ${bp[1]}x${bp[2]} salva.`;
      } else if (lower.includes('ajuda') || lower.includes('passando mal')) {
        document.getElementById('helpModal').classList.remove('hidden');
        box.textContent = `"${txt}" → Abrindo tela de ajuda.`;
      } else if (lower.includes('tomei')) {
        const next = state.medications.find(m => !m.takenToday);
        if (next) { openConfirmFlow(next.id); box.textContent = `"${txt}" → Abrindo confirmação de ${next.name}.`; }
      } else {
        const pend = state.medications.filter(m => !m.takenToday);
        const msg = pend.length ? `Você tem ${pend.map(m => `${m.name} às ${m.time}`).join(', ')}.` : 'Tudo confirmado hoje.';
        box.textContent = `"${txt}" → ${msg}`;
        speak(msg, true);
      }
    };
    rec.onend = () => { btn.classList.remove('mic-active'); lbl.textContent = 'Falar com o Assistente (Ouvir / Cadastrar)'; };
    rec.start();
  }

  // ---- Events ----
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

  document.querySelectorAll('.setup-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sensoryMode = btn.getAttribute('data-smode');
      document.querySelectorAll('.setup-mode').forEach(b => {
        const sel = b === btn;
        b.className = sel
          ? 'setup-mode p-2.5 rounded-xl border-2 border-teal-700 bg-teal-50 text-left font-semibold text-teal-900'
          : 'setup-mode p-2.5 rounded-xl border border-slate-200 bg-white text-left font-semibold text-slate-800';
      });
    });
  });

  document.getElementById('btnFinishSetup').addEventListener('click', () => enterApp(false));
  document.getElementById('btnFinishSetupVoice').addEventListener('click', () => enterApp(true));
  document.querySelectorAll('.nav-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab'))));

  document.getElementById('btnImOk').addEventListener('click', () => {
    state.lastCheckin = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    saveState();
    renderAll();
    toast('Check-in "Estou bem" registrado!');
    speak('Que bom! Check-in de bem-estar registrado.');
  });

  document.getElementById('btnWater').addEventListener('click', () => {
    state.waterCount = (state.waterCount || 0) + 1;
    saveState();
    renderAll();
  });

  document.getElementById('btnVoice').addEventListener('click', startVoice);
  document.getElementById('btnReadToday').addEventListener('click', () => {
    const pend = state.medications.filter(m => !m.takenToday);
    speak(pend.length ? `Seus próximos remédios são: ${pend.map(m => `${m.name} às ${m.time}`).join(', ')}.` : 'Todos os remédios de hoje foram tomados.');
  });

  document.getElementById('btnOpenAddMed').addEventListener('click', () => document.getElementById('quickAddCard').classList.remove('hidden'));
  document.getElementById('btnCloseAddMed').addEventListener('click', () => document.getElementById('quickAddCard').classList.add('hidden'));
  document.getElementById('btnSaveMed').addEventListener('click', () => {
    const name = document.getElementById('newMedName').value.trim();
    const dosage = document.getElementById('newMedDose').value.trim() || '1 dose';
    const time = document.getElementById('newMedTime').value || '08:00';
    if (!name) { toast('Informe o nome.'); return; }
    const med = { id: 'm' + Date.now(), name, dosage, time, stock: 30, takenToday: false, takenAt: '' };
    state.medications.push(med);
    saveState();
    sync('add_medication', med);
    document.getElementById('newMedName').value = '';
    document.getElementById('quickAddCard').classList.add('hidden');
    renderAll();
    toast('Adicionado!');
  });

  document.getElementById('viewHome').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-confirm]');
    if (btn) openConfirmFlow(btn.getAttribute('data-open-confirm'));
  });
  document.getElementById('btnTestModal').addEventListener('click', () => {
    const next = state.medications.find(m => !m.takenToday) || state.medications[0];
    if (next) openConfirmFlow(next.id);
  });

  document.getElementById('btnCmGoing').addEventListener('click', startStep2);
  document.getElementById('btnCmSnooze').addEventListener('click', () => { document.getElementById('confirmModal').classList.add('hidden'); toast('Adiado por 15 minutos.'); });
  document.getElementById('btnCmCancel').addEventListener('click', () => { stopCamera(); if (countdownTimer) clearInterval(countdownTimer); document.getElementById('confirmModal').classList.add('hidden'); });
  document.getElementById('btnCmFinal').addEventListener('click', finalizeConfirm);
  document.getElementById('photoInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) {
      photoAttached = true;
      document.getElementById('photoStatus').textContent = 'Foto registrada!';
      checkCanFinishConfirm(Number(document.getElementById('cmCountdown').textContent) || 0);
    }
  });

  // Ajuda Modal
  function showHelpSub(subId) {
    ['helpMenu', 'helpCalmView', 'helpSickView', 'helpCardView'].forEach(id => document.getElementById(id).classList.toggle('hidden', id !== subId));
  }
  document.getElementById('btnNeedHelp').addEventListener('click', () => { showHelpSub('helpMenu'); document.getElementById('helpModal').classList.remove('hidden'); });
  document.getElementById('btnCloseHelp').addEventListener('click', () => document.getElementById('helpModal').classList.add('hidden'));
  document.getElementById('btnHelpCalm').addEventListener('click', () => { showHelpSub('helpCalmView'); speak('Respire devagar. Inspire por quatro segundos, segure, e solte devagar.'); });
  document.getElementById('btnHelpSick').addEventListener('click', () => showHelpSub('helpSickView'));
  document.getElementById('btnHelpCard').addEventListener('click', () => showHelpSub('helpCardView'));
  document.querySelectorAll('.help-back').forEach(b => b.addEventListener('click', () => showHelpSub('helpMenu')));

  // Pós-consulta
  document.getElementById('btnOpenPostConsult').addEventListener('click', () => document.getElementById('postConsultModal').classList.remove('hidden'));
  document.getElementById('btnClosePostConsult').addEventListener('click', () => document.getElementById('postConsultModal').classList.add('hidden'));
  document.getElementById('btnSavePostConsult').addEventListener('click', () => {
    const payload = {
      mudouMedicacao: document.getElementById('pcChangedMed').checked,
      relatoMedicacao: document.getElementById('pcMedText').value.trim(),
      exameNome: document.getElementById('pcExamName').value.trim(),
      exameData: document.getElementById('pcExamDate').value,
      exameHorario: document.getElementById('pcExamTime').value,
      horasJejum: document.getElementById('pcFastingHours').value,
      dataRetorno: document.getElementById('pcReturnDate').value
    };
    sync('post_consultation', payload);
    document.getElementById('postConsultModal').classList.add('hidden');
    toast('Resumo pós-consulta salvo e enviado à rede de apoio!');
  });

  document.getElementById('btnSaveBP').addEventListener('click', () => {
    saveVitals(document.getElementById('inSys').value, document.getElementById('inDia').value, document.getElementById('inGlucose').value, 'WebApp');
  });

  document.getElementById('btnAddAppt').addEventListener('click', () => {
    const doctor = document.getElementById('apptDoc').value.trim();
    const date = document.getElementById('apptDate').value;
    const time = document.getElementById('apptTime').value;
    if (!doctor || !date || !time) { toast('Preencha todos os campos.'); return; }
    const appt = { id: 'a' + Date.now(), doctor, date, time };
    state.appointments.push(appt);
    saveState();
    sync('add_appointment', appt);
    renderAll();
    toast('Consulta agendada!');
  });
  document.getElementById('apptList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del-appt]');
    if (b) { state.appointments = state.appointments.filter(x => x.id !== b.getAttribute('data-del-appt')); saveState(); renderAll(); }
  });

  document.getElementById('btnSaveCfg').addEventListener('click', () => {
    state.userName = document.getElementById('cfgName').value.trim() || state.userName;
    state.supportPhone = document.getElementById('cfgPhone').value.trim();
    state.supportEmail = document.getElementById('cfgEmail').value.trim();
    state.allergies = document.getElementById('cfgAllergies').value.trim();
    state.sensoryMode = document.getElementById('cfgMode').value;
    state.voiceRate = Number(document.getElementById('cfgRate').value) || 0.95;
    state.requireQr = document.getElementById('cfgReqQr').checked;
    state.requirePhoto = document.getElementById('cfgReqPhoto').checked;
    state.continuousVoice = document.getElementById('cfgContVoice').checked;
        saveState();
    renderAll();
    toast('Configurações salvas!');
  });

  document.getElementById('btnResetSetup').addEventListener('click', showSetup);
  document.getElementById('btnInstall').addEventListener('click', async () => {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
    else { toast('No Chrome: menu ⋮ > Instalar app. No iPhone: Compartilhar > Tela de Início.'); }
  });

  if (state.configured) {
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    renderAll();
  } else {
    showSetup();
  }
})();
