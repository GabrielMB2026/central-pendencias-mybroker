import { useEffect, useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

function fmt(v) { return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function parseValor(raw) {
  if (!raw && raw!==0) return 0;
  const s = String(raw).replace(/[^\d,\.]/g,'');
  const n = s.includes(',')&&s.includes('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(',','.');
  return parseFloat(n)||0;
}
function parseData(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const mBR = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mBR) { const [,d,m,y]=mBR; return d.padStart(2,'0')+'/'+m.padStart(2,'0')+'/'+(y.length===2?'20'+y:y); }
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mISO) return mISO[3]+'/'+mISO[2]+'/'+mISO[1];
  const num = parseFloat(s);
  if (!isNaN(num)&&num>40000&&num<60000) {
    const d = XLSX.SSF.parse_date_code(Math.floor(num));
    if (d) return String(d.d).padStart(2,'0')+'/'+String(d.m).padStart(2,'0')+'/'+d.y;
  }
  return s;
}
function nextId(existing) {
  let max=0;
  existing.forEach(n=>{const m=String(n.id).match(/NEG-(\d+)/);if(m)max=Math.max(max,parseInt(m[1],10));});
  return 'NEG-'+String(max+1).padStart(3,'0');
}

const CAMPOS_IMPORT = [
  {key:'nome_completo', label:'Nome do cliente'},
  {key:'empreendimento', label:'Empreendimento'},
  {key:'responsavel_venda', label:'Responsável pela venda'},
  {key:'situacao', label:'Situação'},
  {key:'valor_divida', label:'Valor da dívida'},
  {key:'data_vencimento', label:'Data de vencimento'},
  {key:'numero_contrato', label:'Número do contrato'},
  {key:'obs', label:'Observações'},
  {key:'ignorar', label:'— Ignorar —'},
];

function guessField(col) {
  const lc = col.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (/nome|cliente|pagador/.test(lc)) return 'nome_completo';
  if (/empreend|produto|imovel/.test(lc)) return 'empreendimento';
  if (/responsav|vendedor|corretor/.test(lc)) return 'responsavel_venda';
  if (/valor|divida|debito|vlr/.test(lc)) return 'valor_divida';
  if (/data|venc|prazo/.test(lc)) return 'data_vencimento';
  if (/contrato|numero|num/.test(lc)) return 'numero_contrato';
  if (/situac|status_sit|sit/.test(lc)) return 'situacao';
  if (/obs|nota|descri/.test(lc)) return 'obs';
  return 'ignorar';
}

export default function Home({ sessao }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const isAdmin = perfil?.role==='admin';
  const isGestor = perfil?.role==='gestor';
  const podeGerenciar = isAdmin||isGestor;

  const [negs, setNegs] = useState([]);
  const [statusList, setStatusList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [fDataDe, setFDataDe] = useState('');
  const [fDataAte, setFDataAte] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [histNew, setHistNew] = useState('');

  // ── Anexos ──
  const [anexos, setAnexos] = useState([]);
  const [uploadingAnexo, setUploadingAnexo] = useState(false);
  const anexoInputRef = useRef(null);

  async function carregarAnexos(negId) {
    const { data } = await supabase.from('anexos').select('*').eq('negociacao_id', negId).order('created_at');
    setAnexos(data || []);
  }

  async function uploadAnexo(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const tipo = ['pdf'].includes(ext) ? 'pdf' : 'image';
    const path = `${editingId}/${Date.now()}_${file.name.replace(/\s/g,'_')}`;
    setUploadingAnexo(true);
    const { error: upErr } = await supabase.storage.from('anexos').upload(path, file, { upsert: false });
    if (upErr) { showToast('Erro no upload: '+upErr.message); setUploadingAnexo(false); return; }
    await supabase.from('anexos').insert({
      negociacao_id: editingId,
      nome_arquivo: file.name,
      tipo,
      tamanho: file.size,
      storage_path: path,
      enviado_por: sessao.user.id,
      enviado_por_nome: perfil?.nome || sessao.user.email,
    });
    setUploadingAnexo(false);
    if (anexoInputRef.current) anexoInputRef.current.value = '';
    await carregarAnexos(editingId);
    showToast('Arquivo anexado!');
  }

  async function abrirAnexo(path) {
    const { data } = await supabase.storage.from('anexos').createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  }

  async function excluirAnexo(id, path) {
    if (!confirm('Remover este anexo?')) return;
    await supabase.storage.from('anexos').remove([path]);
    await supabase.from('anexos').delete().eq('id', id);
    await carregarAnexos(editingId);
    showToast('Anexo removido.');
  }

  function fmtTamanho(bytes) {
    if (bytes < 1024) return bytes+'B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(0)+'KB';
    return (bytes/(1024*1024)).toFixed(1)+'MB';
  }

  // ── Parcelas ──
  const [parcelas, setParcelas] = useState([]);

  function addParcela() {
    setParcelas(prev => [...prev, { id: 'p_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), data:'', valor:'', status:'pendente' }]);
  }
  function removeParcela(id) {
    setParcelas(prev => prev.filter(p => p.id !== id));
  }
  function updateParcela(id, campo, valor) {
    setParcelas(prev => prev.map(p => p.id === id ? {...p, [campo]: valor} : p));
  }
  function gerarParcelasAuto() {
    const qtd = parseInt(form.parcelas_qtd || 0);
    const valorTotal = parseFloat(String(form.valor_divida || '0').replace(',', '.')) || 0;
    const dataBase = form.data_vencimento;
    if (!qtd || qtd < 1) return;
    const valorParcela = valorTotal > 0 ? Math.round((valorTotal / qtd) * 100) / 100 : 0;
    const novas = [];
    for (let i = 0; i < qtd; i++) {
      let dataP = '';
      if (dataBase) {
        const [d, m, y] = dataBase.split('/').map(Number);
        if (d && m && y) {
          const dt = new Date(y, m - 1 + i, d);
          dataP = String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear();
        }
      }
      novas.push({ id: 'p_'+(Date.now()+i)+'_'+i, data: dataP, valor: valorParcela || '', status: 'pendente' });
    }
    setParcelas(novas);
  }

  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState(1);
  const [detectedCols, setDetectedCols] = useState([]);
  const [importedRows, setImportedRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [linhasRevisao, setLinhasRevisao] = useState([]);
  const fileInputRef = useRef(null);

  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const showToast = useCallback((msg)=>{
    setToast(msg);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(''),3500);
  },[]);

  useEffect(()=>{ if(sessao) carregar(); },[sessao]);

  const carregar = useCallback(async()=>{
    setLoading(true);
    const [{ data:p }, { data:n }, { data:st }] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('id',sessao.user.id).single(),
      supabase.from('negociacoes').select('*, clientes(*), status_config(*)').order('created_at',{ascending:false}),
      supabase.from('status_config').select('*').eq('ativo',true).order('ordem'),
    ]);
    const role = p?.role || 'operador';
    const todosStatus = st || [];

    // ── Regras automáticas: verifica transições por prazo de vencimento ──
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    // Função: dado diasDesdeVenc, percorre a cadeia de status e retorna
    // o status correto com base nos prazos configurados
    function statusCorreto(diasDesdeVenc) {
      // Pega todos status ordenados com prazo definido
      const comPrazo = todosStatus
        .filter(s => s.prazo_dias && s.proximo_status_id)
        .sort((a, b) => b.prazo_dias - a.prazo_dias); // maior prazo primeiro
      for (const s of comPrazo) {
        if (diasDesdeVenc >= s.prazo_dias) {
          // Retorna o próximo status desse estágio
          return todosStatus.find(x => x.id === s.proximo_status_id) || null;
        }
      }
      return null; // ainda dentro do prazo, sem mudança
    }

    for (const neg of (n||[])) {
      if (!neg.data_vencimento) continue;
      const partes = String(neg.data_vencimento).split('/');
      if (partes.length !== 3) continue;
      const dtVenc = new Date(parseInt(partes[2]), parseInt(partes[1])-1, parseInt(partes[0]));
      dtVenc.setHours(0,0,0,0);
      const diasDesdeVenc = Math.round((hoje - dtVenc) / 86400000);

      // Verifica transição do status atual (se tiver próximo configurado)
      const stAtual = todosStatus.find(s => s.id === neg.status_id);
      if (stAtual && stAtual.proximo_status_id && stAtual.prazo_dias && diasDesdeVenc >= stAtual.prazo_dias) {
        const proxStatus = todosStatus.find(s => s.id === stAtual.proximo_status_id);
        const dateStr = hoje.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
        const hist = Array.isArray(neg.historico) ? neg.historico : [];
        const novoHist = [...hist,
          `${dateStr} - Status alterado automaticamente: "${stAtual.nome}" → "${proxStatus?.nome||'?'}" (${diasDesdeVenc} dias desde o vencimento)`
        ];
        await supabase.from('negociacoes').update({
          status_id: stAtual.proximo_status_id,
          responsavel_cobranca: proxStatus?.responsavel || neg.responsavel_cobranca,
          historico: novoHist,
          updated_at: new Date().toISOString(),
        }).eq('id', neg.id);
        neg.status_id = stAtual.proximo_status_id;
        neg.responsavel_cobranca = proxStatus?.responsavel || neg.responsavel_cobranca;
        neg.historico = novoHist;
      }
      // Se o status atual NÃO tem regra configurada mas o vencimento já passou,
      // encontra o status correto percorrendo a cadeia
      else if (diasDesdeVenc > 0 && stAtual && !stAtual.prazo_dias) {
        const stCorreto = statusCorreto(diasDesdeVenc);
        if (stCorreto && stCorreto.id !== neg.status_id) {
          const dateStr = hoje.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
          const hist = Array.isArray(neg.historico) ? neg.historico : [];
          const novoHist = [...hist,
            `${dateStr} - Status corrigido automaticamente: "${stAtual.nome}" → "${stCorreto.nome}" (${diasDesdeVenc} dias desde o vencimento)`
          ];
          await supabase.from('negociacoes').update({
            status_id: stCorreto.id,
            responsavel_cobranca: stCorreto.responsavel || neg.responsavel_cobranca,
            historico: novoHist,
            updated_at: new Date().toISOString(),
          }).eq('id', neg.id);
          neg.status_id = stCorreto.id;
          neg.responsavel_cobranca = stCorreto.responsavel || neg.responsavel_cobranca;
          neg.historico = novoHist;
        }
      }
    }

    // ── Filtra status e negociações visíveis para o perfil ──
    const statusVisiveis = todosStatus.filter(s =>
      !s.perfis_visiveis || s.perfis_visiveis.length === 0 || s.perfis_visiveis.includes(role)
    );
    const idsVisiveis = new Set(statusVisiveis.map(s => s.id));
    const negsFiltradas = (n||[]).filter(neg => !neg.status_id || idsVisiveis.has(neg.status_id));

    setPerfil(p); setNegs(negsFiltradas); setStatusList(statusVisiveis);
    setLoading(false);
  },[sessao]);

  const filtered = negs.filter(n=>{
    const b=busca.toLowerCase();
    const bOk=!b||[n.clientes?.nome_completo,n.clientes?.empreendimento,n.id,n.clientes?.responsavel_venda].some(x=>(x||'').toLowerCase().includes(b));
    if(!bOk) return false;
    if(fStatus && n.status_id!==fStatus) return false;
    return true;
  });

  const metrics = {
    total: negs.length,
    porStatus: statusList.map(s=>({ ...s, count: negs.filter(n=>n.status_id===s.id).length })),
    valorTotal: negs.reduce((a,n)=>a+Number(n.valor_divida||0),0),
  };

  // ── Modal ──
  function openModal(neg=null) {
    setEditingId(neg?.id||null);
    if(neg) {
      setForm({
        nome_completo: neg.clientes?.nome_completo||'',
        empreendimento: neg.clientes?.empreendimento||'',
        responsavel_venda: neg.clientes?.responsavel_venda||'',
        status_id: neg.status_id||'',
        situacao: neg.situacao||'',
        responsavel_cobranca: neg.responsavel_cobranca||'',
        valor_divida: neg.valor_divida||'',
        data_vencimento: neg.data_vencimento||'',
        numero_contrato: neg.numero_contrato||'',
        obs: neg.obs||'',
        historico: neg.historico||[],
        cliente_id: neg.cliente_id,
      });
    } else {
      setForm({ nome_completo:'', empreendimento:'', responsavel_venda:'', status_id: statusList[0]?.id||'', situacao:'', responsavel_cobranca:'', valor_divida:'', data_vencimento:'', numero_contrato:'', obs:'', historico:[] });
    }
    setHistNew(''); setParcelas(neg?.parcelas || []);
    if (neg?.id) carregarAnexos(neg.id); else setAnexos([]);
    setModalOpen(true);
  }

  async function salvar() {
    if (!form.nome_completo?.trim()) { showToast('Preencha o nome do cliente.'); return; }
    setSaving(true);
    const nomeResp = perfil?.nome||sessao?.user?.email||'Sistema';
    const dateStr = new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    try {
      if(editingId) {
        const neg = negs.find(n=>n.id===editingId);
        const { error: eCli } = await supabase.from('clientes')
          .update({ nome_completo:form.nome_completo, empreendimento:form.empreendimento, responsavel_venda:form.responsavel_venda })
          .eq('id',form.cliente_id);
        if (eCli) throw new Error('Erro ao atualizar cliente: '+eCli.message);
        const novoHist = [...(neg.historico||[]), histNew ? `${dateStr} - ${histNew} (${nomeResp})` : `${dateStr} - Atualizado por ${nomeResp}`];
        const { error: eNeg } = await supabase.from('negociacoes')
          .update({ status_id:form.status_id, responsavel_cobranca:form.responsavel_cobranca, situacao:form.situacao||null, valor_divida:parseFloat(form.valor_divida)||0, data_vencimento:form.data_vencimento, numero_contrato:form.numero_contrato, obs:form.obs, historico:novoHist, parcelas: JSON.parse(JSON.stringify(parcelas)), updated_at:new Date().toISOString() })
          .eq('id',editingId);
        if (eNeg) throw new Error('Erro ao atualizar negociação: '+eNeg.message);
      } else {
        const { data:cli, error: eCli } = await supabase.from('clientes')
          .insert({ nome_completo:form.nome_completo, empreendimento:form.empreendimento, responsavel_venda:form.responsavel_venda })
          .select().single();
        if (eCli || !cli) throw new Error('Erro ao criar cliente: '+(eCli?.message||'sem retorno'));
        const newId = nextId(negs);
        const { error: eNeg } = await supabase.from('negociacoes')
          .insert({ id:newId, cliente_id:cli.id, status_id:form.status_id||null, responsavel_cobranca:form.responsavel_cobranca, valor_divida:parseFloat(form.valor_divida)||0, data_vencimento:form.data_vencimento, numero_contrato:form.numero_contrato, obs:form.obs, situacao:form.situacao||null, historico:[`${dateStr} - Criado por ${nomeResp}`], parcelas: JSON.parse(JSON.stringify(parcelas)) });
        if (eNeg) throw new Error('Erro ao criar negociação: '+eNeg.message);
      }
      await carregar();
      setModalOpen(false);
      showToast('Negociação salva!');
    } catch(err) {
      console.error('Erro ao salvar:', err);
      showToast('Erro: '+err.message);
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id) {
    if(!confirm('Excluir negociação '+id+'?')) return;
    await supabase.from('negociacoes').delete().eq('id',id);
    await carregar(); showToast('Excluído.');
  }

  // ── Importação ──
  function handleFile(e) {
    const file=e.target.files[0]; if(!file) return;
    setFileName(file.name);
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const bytes=new Uint8Array(ev.target.result);
      if(file.name.toLowerCase().endsWith('.csv')) {
        let texto=new TextDecoder('utf-8').decode(bytes);
        if(/Ã[£¢§¡©ª«¬­®°±]/.test(texto)) texto=new TextDecoder('windows-1252').decode(bytes);
        parseCsvTexto(texto);
      } else {
        const wb=XLSX.read(bytes,{type:'array',raw:true,cellDates:false});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
        if(!json||json.length<2){alert('Arquivo vazio.');return;}
        finalizarImport(json[0].map(String), json.slice(1).filter(r=>r.some(c=>String(c).trim()!=='')));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseCsvTexto(texto) {
    const linhas=[]; let campo='',campos=[],dentroAspas=false;
    for(let i=0;i<texto.length;i++){
      const c=texto[i];
      if(c==='"'){if(dentroAspas&&texto[i+1]==='"'){campo+='"';i++;}else dentroAspas=!dentroAspas;}
      else if(c===','&&!dentroAspas){campos.push(campo);campo='';}
      else if((c==='\n'||c==='\r')&&!dentroAspas){campos.push(campo);campo='';if(campos.some(f=>f.trim()))linhas.push(campos);campos=[];if(c==='\r'&&texto[i+1]==='\n')i++;}
      else campo+=c;
    }
    if(campo||campos.length){campos.push(campo);if(campos.some(f=>f.trim()))linhas.push(campos);}
    if(linhas.length<2){alert('Arquivo vazio.');return;}
    finalizarImport(linhas[0].map(String), linhas.slice(1).filter(r=>r.some(c=>String(c).trim()!=='')));
  }

  function finalizarImport(cols, rows) {
    setDetectedCols(cols); setImportedRows(rows);
    const m={}; cols.forEach((col,i)=>{m[i]=guessField(col);}); setMapping(m);
  }

  function getMappingByField() {
    const m={};
    Object.entries(mapping).forEach(([idx,field])=>{if(field&&field!=='ignorar')m[field]=parseInt(idx,10);});
    return m;
  }

  function gerarLinhasRevisao() {
    const map=getMappingByField();
    setLinhasRevisao(importedRows.map((row,i)=>({
      _idx:i,
      nome_completo: map.nome_completo!==undefined ? String(row[map.nome_completo]||'') : '',
      empreendimento: map.empreendimento!==undefined ? String(row[map.empreendimento]||'') : '',
      responsavel_venda: map.responsavel_venda!==undefined ? String(row[map.responsavel_venda]||'') : '',
      situacao: map.situacao!==undefined ? String(row[map.situacao]||'') : '',
      valor_divida: map.valor_divida!==undefined ? parseValor(row[map.valor_divida]) : 0,
      data_vencimento: map.data_vencimento!==undefined ? parseData(row[map.data_vencimento]) : '',
      numero_contrato: map.numero_contrato!==undefined ? String(row[map.numero_contrato]||'') : '',
      obs: map.obs!==undefined ? String(row[map.obs]||'') : '',
    })));
    setImportStep(2);
  }

  function atualizarLinha(idx,campo,valor){
    setLinhasRevisao(prev=>prev.map((l,i)=>i===idx?{...l,[campo]:valor}:l));
  }

  async function doImport() {
    setSaving(true);
    const dateStr=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const nomeResp=perfil?.nome||sessao?.user?.email||'Sistema';
    const statusPadrao=statusList[0]?.id||null;
    let seed=[...negs];
    for(const linha of linhasRevisao) {
      if(!linha.nome_completo.trim()) continue;
      const {data:cli}=await supabase.from('clientes').insert({ nome_completo:linha.nome_completo, empreendimento:linha.empreendimento, responsavel_venda:linha.responsavel_venda }).select().single();
      const newId=nextId(seed);
      await supabase.from('negociacoes').insert({ id:newId, cliente_id:cli.id, status_id:statusPadrao, situacao:linha.situacao||null, valor_divida:parseFloat(String(linha.valor_divida).replace(',','.'))||0, data_vencimento:linha.data_vencimento, numero_contrato:linha.numero_contrato, obs:linha.obs, historico:[`${dateStr} - Importado por ${nomeResp}`] });
      seed=[...seed,{id:newId}];
    }
    setSaving(false);
    setImportOpen(false); setImportStep(1);
    setDetectedCols([]); setImportedRows([]); setFileName(''); setLinhasRevisao([]);
    if(fileInputRef.current) fileInputRef.current.value='';
    await carregar();
    showToast(linhasRevisao.length+' negociação(ões) importada(s)!');
  }

  function cancelarImport(){
    setImportOpen(false); setImportStep(1);
    setDetectedCols([]); setImportedRows([]); setFileName(''); setLinhasRevisao([]);
    if(fileInputRef.current) fileInputRef.current.value='';
  }

  function exportExcel(){
    if(!negs.length){alert('Nenhuma negociação.');return;}
    const rows=filtered.map(n=>({'ID':n.id,'Cliente':n.clientes?.nome_completo||'','Empreendimento':n.clientes?.empreendimento||'','Resp. Venda':n.clientes?.responsavel_venda||'','Status':n.status_config?.nome||'','Situação':n.situacao||'','Resp. Cobrança':n.responsavel_cobranca||'','Valor':n.valor_divida||0,'Vencimento':n.data_vencimento||'','Contrato':n.numero_contrato||'','Obs':n.obs||'','Histórico':(n.historico||[]).join(' | ')}));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Negociações');
    XLSX.writeFile(wb,'Cobranca_BPO_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.xlsx');
  }

  async function handleLogout(){ await supabase.auth.signOut(); router.replace('/login'); }

  return (
    <>
      <Head>
        <title>Cobrança BPO · Negociações</title>
        
      </Head>

      {/* HEADER */}
      <header className="hdr">
        <div className="hdr-left">
          <div className="hdr-logo">⚡</div>
          <div>
            <div className="hdr-eyebrow">Plataforma de Cobrança</div>
            <div className="hdr-title">Negociações<span style={{color:"var(--signal)"}}>.</span></div>
          </div>
        </div>
        <div className="hdr-right">
          {podeGerenciar && <button className="btn-ghost" onClick={()=>setImportOpen(v=>!v)}>↓ Importar</button>}
          <button className="btn-ghost" onClick={exportExcel}>↑ Exportar</button>
          <button className="btn-nova" onClick={()=>openModal()}>+ Nova</button>
          {podeGerenciar && <button className="btn-ghost" onClick={()=>router.push('/configuracoes')} title="Configurações">⚙</button>}
          {podeGerenciar && <button className="btn-ghost" onClick={()=>router.push('/situacoes')} title="Situações">📋</button>}
          {isAdmin && <button className="btn-ghost" onClick={()=>router.push('/admin')} title="Usuários">👥</button>}
          <button className="btn-ghost" onClick={()=>router.push('/dashboard')} title="Dashboard">📊</button>
          <div className="user-chip">
            <span>{perfil?.nome||sessao?.user?.email}</span>
            <span className={'role-tag role-'+perfil?.role}>{perfil?.role}</span>
            <button className="logout-btn" onClick={handleLogout} title="Sair">⏻</button>
          </div>
        </div>
      </header>

      {/* MÉTRICAS */}
      <div className="metrics-bar">
        <div className="metric" onClick={()=>setFStatus('')} style={{cursor:'pointer',outline:fStatus===''?'1px solid var(--accent)':'none'}}>
          <div className="metric-val">{metrics.total}</div>
          <div className="metric-lbl">Total</div>
        </div>
        {metrics.porStatus.map(s=>(
          <div key={s.id} className="metric" onClick={()=>setFStatus(fStatus===s.id?'':s.id)} style={{cursor:'pointer',outline:fStatus===s.id?'1px solid '+s.cor:'none',outlineOffset:'-1px'}}>
            <div className="metric-val" style={{color:s.cor}}>{s.count}</div>
            <div className="metric-lbl">{s.nome}</div>
          </div>
        ))}
        <div className="metric metric-valor">
          <div className="metric-val sm">{fmt(metrics.valorTotal)}</div>
          <div className="metric-lbl">Valor total</div>
        </div>
      </div>

      {/* IMPORT PANEL */}
      {podeGerenciar && importOpen && (
        <div className="import-panel">
          {importStep===1 && (
            <>
              <div className="panel-title">Importar Negociações — Etapa 1: Arquivo e Mapeamento</div>
              <div className="import-grid">
                <div className="import-col">
                  <div className="import-label">01 · Selecionar arquivo</div>
                  <label className="drop-zone">
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{display:'none'}}/>
                    <div className="drop-icon">📁</div>
                    <div className="drop-txt">Clique para selecionar</div>
                    <div className="drop-hint">.xlsx · .xls · .csv</div>
                  </label>
                  {fileName && <div className="file-ok">✓ {fileName}</div>}
                </div>
                <div className="import-col">
                  <div className="import-label">02 · Mapear colunas</div>
                  {detectedCols.length===0
                    ? <div className="map-empty">Carregue um arquivo primeiro</div>
                    : detectedCols.map((col,i)=>(
                      <div className="map-row" key={i}>
                        <div className="map-lbl">{col}</div>
                        <div className="map-arr">→</div>
                        <select className="map-sel" value={mapping[i]||'ignorar'} onChange={e=>setMapping(m=>({...m,[i]:e.target.value}))}>
                          {CAMPOS_IMPORT.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="import-footer">
                <span className="import-info">{importedRows.length>0?`${importedRows.length} linhas · ${detectedCols.length} colunas`:''}</span>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn-ghost" onClick={cancelarImport}>Cancelar</button>
                  {importedRows.length>0 && <button className="btn-accent" onClick={gerarLinhasRevisao}>Revisar →</button>}
                </div>
              </div>
            </>
          )}

          {importStep===2 && (
            <>
              <div className="panel-title">Importar Negociações — Etapa 2: Revisão</div>
              <div className="rev-hint">Verifique e edite os campos antes de salvar. Clique em qualquer célula para corrigir.</div>
              <div className="rev-wrap">
                <table className="rev-table">
                  <thead>
                    <tr><th>#</th><th>Cliente</th><th>Empreendimento</th><th>Situação</th><th>Valor</th><th>Vencimento</th><th>Obs</th></tr>
                  </thead>
                  <tbody>
                    {linhasRevisao.map((l,i)=>(
                      <tr key={i}>
                        <td className="rev-num">{i+1}</td>
                        <td><input className={'rev-input'+(l.nome_completo?'':' rev-vazio')} value={l.nome_completo} onChange={e=>atualizarLinha(i,'nome_completo',e.target.value)} placeholder="— obrigatório —"/></td>
                        <td><input className="rev-input" value={l.empreendimento} onChange={e=>atualizarLinha(i,'empreendimento',e.target.value)} placeholder="—"/></td>
                        <td><input className="rev-input" style={{width:140}} value={l.situacao} onChange={e=>atualizarLinha(i,'situacao',e.target.value)} placeholder="—"/></td>
                        <td><input className="rev-input" style={{width:110}} value={l.valor_divida} onChange={e=>atualizarLinha(i,'valor_divida',e.target.value)} placeholder="0,00"/></td>
                        <td><input className="rev-input" style={{width:110}} value={l.data_vencimento} onChange={e=>atualizarLinha(i,'data_vencimento',e.target.value)} placeholder="DD/MM/AAAA"/></td>
                        <td><input className="rev-input" style={{width:140}} value={l.obs} onChange={e=>atualizarLinha(i,'obs',e.target.value)} placeholder="—"/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-footer">
                <span className="import-info">{linhasRevisao.length} negociação(ões) para importar</span>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn-ghost" onClick={cancelarImport}>Cancelar</button>
                  <button className="btn-ghost" onClick={()=>setImportStep(1)}>← Voltar</button>
                  <button className="btn-accent" onClick={doImport} disabled={saving}>{saving?'Salvando...':'✓ Confirmar e salvar'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TOOLBAR */}
      <div className="toolbar">
        <input className="search-input" type="text" placeholder="🔍 Buscar cliente, empreendimento, ID..." value={busca} onChange={e=>setBusca(e.target.value)}/>
        <button className={'btn-ghost'+(filtrosAbertos?' active':'')} onClick={()=>setFiltrosAbertos(v=>!v)}>⚙ Filtros</button>
        {(busca||fStatus||fDataDe||fDataAte) && <button className="btn-clear" onClick={()=>{setBusca('');setFStatus('');setFDataDe('');setFDataAte('');}}>✕ Limpar</button>}
        {loading && <span className="loading-txt">carregando...</span>}
        <span className="result-count">{filtered.length} de {negs.length}</span>
      </div>

      {filtrosAbertos && (
        <div className="filter-panel">
          <div className="filter-group">
            <label>Status</label>
            <select value={fStatus} onChange={e=>setFStatus(e.target.value)}>
              <option value="">Todos</option>
              {statusList.map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label>Vencimento — De</label>
            <input type="text" placeholder="DD/MM/AAAA" value={fDataDe} onChange={e=>setFDataDe(e.target.value)}/>
          </div>
          <div className="filter-group">
            <label>Vencimento — Até</label>
            <input type="text" placeholder="DD/MM/AAAA" value={fDataAte} onChange={e=>setFDataAte(e.target.value)}/>
          </div>
        </div>
      )}

      {/* TABELA */}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>ID</th><th>Cliente</th><th>Empreendimento</th>
              <th>Resp. Venda</th><th>Vencimento</th><th>Valor</th>
              <th>Status</th><th>Situação</th><th>Resp. Cobrança</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 ? (
              <tr><td colSpan={9} className="empty-row">{loading?'Carregando...':'Nenhuma negociação encontrada'}</td></tr>
            ) : filtered.map(n=>{
              const st = n.status_config;
              return (
                <tr key={n.id} className="tbl-row">
                  <td className="id-cell">{n.id}</td>
                  <td className="cell-primary">{n.clientes?.nome_completo||'—'}</td>
                  <td className="cell-sec">{n.clientes?.empreendimento||'—'}</td>
                  <td className="cell-sec">{n.clientes?.responsavel_venda||'—'}</td>
                  <td className="cell-mono">{n.data_vencimento||'—'}</td>
                  <td className="cell-mono">{fmt(n.valor_divida)}</td>
                  <td>
                    {st ? (
                      <span className="status-pill" style={{background:st.cor+'22',color:st.cor,borderColor:st.cor+'44'}}>
                        {st.nome}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="cell-sec">{n.situacao||<span className="cell-empty">—</span>}</td>
                  <td className="cell-sec">{n.responsavel_cobranca||<span className="cell-empty">a definir</span>}</td>
                  <td className="cell-actions">
                    <button className="act-btn" onClick={()=>openModal(n)}>editar</button>
                    {isAdmin && <button className="act-btn danger" onClick={()=>excluir(n.id)}>excluir</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {modalOpen && (
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setModalOpen(false)}}>
          <div className="modal">
            <div className="modal-hdr">
              <div>
                <div className="modal-eyebrow">Cobrança BPO · Negociação</div>
                <div className="modal-title">{editingId?`Editar — ${editingId}`:'Nova Negociação'}</div>
              </div>
              <button className="modal-close" onClick={()=>setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="modal-section">Dados do Cliente</div>
              <div className="form-grid">
                <div className="fg"><label>Nome completo *</label><input type="text" value={form.nome_completo||''} onChange={e=>setForm(f=>({...f,nome_completo:e.target.value}))} placeholder="Nome do cliente"/></div>
                <div className="fg"><label>Empreendimento</label><input type="text" value={form.empreendimento||''} onChange={e=>setForm(f=>({...f,empreendimento:e.target.value}))} placeholder="Nome do empreendimento"/></div>
                <div className="fg full"><label>Responsável pela venda</label><input type="text" value={form.responsavel_venda||''} onChange={e=>setForm(f=>({...f,responsavel_venda:e.target.value}))} placeholder="Nome do responsável pela venda"/></div>
              </div>
              <div className="modal-section" style={{marginTop:16}}>Dados da Negociação</div>
              <div className="form-grid">
                <div className="fg"><label>Status</label>
                  {perfil?.role === 'operador' ? (
                    // Operador: só pode avançar para o próximo status configurado
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      <div className="status-atual-pill" style={{
                        background: (statusList.find(s=>s.id===form.status_id)?.cor||'#8A96B0')+'22',
                        color: statusList.find(s=>s.id===form.status_id)?.cor||'#8A96B0',
                        border: `1px solid ${statusList.find(s=>s.id===form.status_id)?.cor||'#8A96B0'}44`,
                        padding:'6px 12px', fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:2, textTransform:'uppercase', fontWeight:700,
                      }}>
                        {statusList.find(s=>s.id===form.status_id)?.nome || 'Sem status'}
                      </div>
                      {(() => {
                        const stAtual = statusList.find(s=>s.id===form.status_id);
                        const proxId = stAtual?.proximo_status_id;
                        const proxStatus = proxId ? statusList.find(s=>s.id===proxId) : null;
                        if (proxStatus && stAtual?.permite_avanco_manual !== false) return (
                          <button type="button" className="btn-avancar"
                            onClick={()=>setForm(f=>({...f,status_id:proxStatus.id}))}
                            style={{borderColor:proxStatus.cor,color:proxStatus.cor}}>
                            Avançar para: {proxStatus.nome} →
                          </button>
                        );
                        if (!proxStatus) return <div style={{fontSize:10,color:'#8A90A8',fontStyle:'italic'}}>Último status do fluxo</div>;
                        return <div style={{fontSize:10,color:'#8A90A8',fontStyle:'italic'}}>🔒 Avanço automático apenas</div>;
                      })()}
                    </div>
                  ) : (
                    // Gestor/Admin: vê todos os status
                    <select value={form.status_id||''} onChange={e=>setForm(f=>({...f,status_id:e.target.value}))}>
                      {statusList.map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  )}
                </div>
                <div className="fg"><label>Situação</label><select value={form.situacao||''} onChange={e=>setForm(f=>({...f,situacao:e.target.value}))}><option value="">— Selecione —</option>
                              <option value="Acordo em negociação">Acordo em negociação</option>
                              <option value="Acordo Formalizado">Acordo Formalizado</option>
                              <option value="Descumprimento de Acordo">Descumprimento de Acordo</option>
                              <option value="Em Judicialização">Em Judicialização</option>
                              <option value="Enviado Jurídico">Enviado Jurídico</option>
                              <option value="Judicializado">Judicializado</option>
                              <option value="Perdido">Perdido</option>
                              <option value="Protestar">Protestar</option></select></div>
                <div className="fg"><label>Responsável pela cobrança</label><input type="text" value={form.responsavel_cobranca||''} onChange={e=>setForm(f=>({...f,responsavel_cobranca:e.target.value}))} placeholder="Quem está acompanhando"/></div>
                <div className="fg"><label>Valor da dívida (R$)</label><input type="number" min="0" step="0.01" value={form.valor_divida||''} onChange={e=>setForm(f=>({...f,valor_divida:e.target.value}))} placeholder="0,00"/></div>
                <div className="fg"><label>Data de vencimento</label><input type="text" value={form.data_vencimento||''} onChange={e=>setForm(f=>({...f,data_vencimento:e.target.value}))} placeholder="DD/MM/AAAA"/></div>
                <div className="fg"><label>Número do contrato</label><input type="text" value={form.numero_contrato||''} onChange={e=>setForm(f=>({...f,numero_contrato:e.target.value}))} placeholder="Nº do contrato"/></div>
                <div className="fg full"><label>Observações</label><textarea value={form.obs||''} onChange={e=>setForm(f=>({...f,obs:e.target.value}))} placeholder="Tratativas, contatos realizados..."/></div>
              </div>

              {/* ── PARCELAS ── */}
              <div className="modal-section" style={{marginTop:16}}>Parcelas</div>
              <div className="parcelas-toolbar">
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <input
                    className="parcela-input-qtd"
                    type="number" min="1" max="360"
                    placeholder="Qtd de parcelas"
                    value={form.parcelas_qtd||''}
                    onChange={e=>setForm(f=>({...f,parcelas_qtd:e.target.value}))}
                  />
                  <button className="btn-parcela-gerar" onClick={gerarParcelasAuto} type="button">
                    ⚡ Gerar automaticamente
                  </button>
                  <span className="parcela-hint">ou</span>
                  <button className="btn-parcela-add" onClick={addParcela} type="button">
                    + Adicionar parcela manualmente
                  </button>
                </div>
                {parcelas.length > 0 && (
                  <div className="parcelas-resumo">
                    {parcelas.length} parcela(s) · {' '}
                    Pagas: {parcelas.filter(p=>p.status==='pago').length} · {' '}
                    Pendentes: {parcelas.filter(p=>p.status==='pendente').length} · {' '}
                    Total: R$ {parcelas.reduce((a,p)=>a+parseFloat(String(p.valor||0).replace(',','.'))||0,0).toLocaleString('pt-BR',{minimumFractionDigits:2})}
                  </div>
                )}
              </div>
              {parcelas.length > 0 && (
                <div className="parcelas-wrap">
                  <table className="parcelas-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Vencimento</th>
                        <th>Valor (R$)</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcelas.map((p, i) => (
                        <tr key={p.id} className={'parcela-row '+(p.status==='pago'?'parcela-pago':'')}>
                          <td className="parcela-num">{i+1}</td>
                          <td>
                            <input
                              className="parcela-field"
                              type="text"
                              placeholder="DD/MM/AAAA"
                              value={p.data}
                              onChange={e=>updateParcela(p.id,'data',e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="parcela-field"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0,00"
                              value={p.valor}
                              onChange={e=>updateParcela(p.id,'valor',e.target.value)}
                            />
                          </td>
                          <td>
                            <select
                              className={'parcela-status '+(p.status==='pago'?'status-pago':'status-pendente')}
                              value={p.status}
                              onChange={e=>updateParcela(p.id,'status',e.target.value)}
                            >
                              <option value="pendente">Pendente</option>
                              <option value="pago">Pago</option>
                              <option value="atrasado">Atrasado</option>
                              <option value="cancelado">Cancelado</option>
                            </select>
                          </td>
                          <td>
                            <button className="parcela-del" onClick={()=>removeParcela(p.id)} type="button" title="Remover">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {parcelas.length === 0 && (
                <div className="parcelas-empty">Nenhuma parcela cadastrada. Use os botões acima para adicionar.</div>
              )}
              {editingId && (
                <>
                  <div className="modal-section" style={{marginTop:16}}>Histórico</div>
                  <ul className="hist-list">
                    {(form.historico||[]).map((h,i)=><li key={i} className="hist-item">{h}</li>)}
                  </ul>
                  <input className="hist-input" type="text" placeholder="Adicionar registro ao histórico..." value={histNew} onChange={e=>setHistNew(e.target.value)}/>
                </>
              )}

              {/* ── ANEXOS ── */}
              {editingId && (
                <>
                  <div className="modal-section" style={{marginTop:16}}>Anexos</div>
                  <div className="anexos-toolbar">
                    <label className="btn-anexar">
                      <input ref={anexoInputRef} type="file" accept=".pdf,image/*" onChange={uploadAnexo} style={{display:'none'}} disabled={uploadingAnexo}/>
                      {uploadingAnexo ? '⏳ Enviando...' : '📎 Adicionar arquivo'}
                    </label>
                    <span className="anexo-hint">PDF ou imagem · máx 10MB</span>
                  </div>
                  {anexos.length === 0
                    ? <div className="anexos-empty">Nenhum arquivo anexado ainda.</div>
                    : <div className="anexos-list">
                        {anexos.map(a=>(
                          <div key={a.id} className="anexo-row">
                            <span className="anexo-icon">{a.tipo==='pdf'?'📄':'🖼'}</span>
                            <div className="anexo-info">
                              <div className="anexo-nome">{a.nome_arquivo}</div>
                              <div className="anexo-meta">{fmtTamanho(a.tamanho)} · {a.enviado_por_nome} · {new Date(a.created_at).toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div className="anexo-actions">
                              <button className="act-btn" onClick={()=>abrirAnexo(a.storage_path)}>abrir</button>
                              {(perfil?.role==='admin'||perfil?.role==='gestor') && (
                                <button className="act-btn danger" onClick={()=>excluirAnexo(a.id,a.storage_path)}>remover</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={()=>setModalOpen(false)}>Cancelar</button>
              <button className="btn-accent" onClick={salvar} disabled={saving}>{saving?'Salvando...':'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      <div className={'toast'+(toast?' show':'')}>{toast}</div>

      <style>{`
        :root{--bg:#0F1117;--surface:#1A1D27;--surface2:#22263A;--border:#2A2D3A;--accent:var(--accent);--text:#E8EAF0;--text2:#B8BDD0;--muted:#8A90A8;--danger:var(--danger);--green:var(--green);}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:var(--font-display);background:var(--bg);color:var(--text)}

        /* Header */
        .hdr{background-color:var(--surface);background-image:repeating-linear-gradient(-58deg,transparent 0 11px,oklch(0.656 0.231 29.3 / 8%) 11px 12px);border-bottom:1px solid var(--border);padding:0 24px;height:54px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;z-index:90}
        .hdr-left{display:flex;align-items:center;gap:12px}
        .hdr-logo{width:34px;height:34px;background:linear-gradient(135deg,var(--accent),var(--accent));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
        .hdr-eyebrow{font-family:var(--font-mono);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
        .hdr-title{font-size:16px;font-weight:800;color:var(--text);letter-spacing:.2px}
        .hdr-right{display:flex;align-items:center;gap:6px}
        .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 12px;font-size:11px;cursor:pointer;transition:all .15s;font-family:var(--font-mono);letter-spacing:1px}
        .btn-ghost:hover,.btn-ghost.active{border-color:var(--accent);color:var(--accent)}
        .btn-accent{background:var(--accent);color:#fff;border:none;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
        .btn-nova{background:var(--late);color:#fff;border:none;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:opacity .15s}
        .btn-nova:hover{opacity:.85}
        .btn-accent:hover{background:color-mix(in oklch, var(--accent) 85%, black)}
        .btn-accent:disabled{opacity:.6;cursor:not-allowed}
        .btn-accent.sm{padding:5px 12px;font-size:11px}
        .btn-clear{background:transparent;border:1px solid var(--danger);color:var(--danger);padding:5px 10px;font-size:11px;cursor:pointer;font-family:var(--font-mono);letter-spacing:1px}
        .user-chip{display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);padding:4px 10px 4px 12px}
        .user-chip span:first-child{font-size:12px;font-weight:500;color:var(--text)}
        .role-tag{font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;padding:2px 6px}
        .role-admin{background:oklch(from var(--accent) l c h / 0.2);color:var(--accent)}
        .role-gestor{background:rgba(99,102,241,.2);color:#818CF8}
        .role-operador{background:rgba(255,255,255,.08);color:var(--text2)}
        .logout-btn{background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--text2);width:26px;height:26px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s}
        .logout-btn:hover{border-color:var(--danger);color:var(--danger)}

        /* Métricas */
        .metrics-bar{display:flex;gap:2px;padding:0 0;border-bottom:1px solid var(--border);background-image:repeating-linear-gradient(-58deg,transparent 0 11px,oklch(0.656 0.231 29.3 / 5%) 11px 12px)}
        .metric{flex:1;padding:14px 20px;background:var(--surface);cursor:default;transition:background .15s;border-bottom:2px solid transparent}
        .metric:hover{background:var(--surface2)}
        .metric-val{font-size:28px;font-weight:700;line-height:1;color:var(--text)}
        .metric-val.sm{font-size:16px;font-weight:600}
        .metric-lbl{font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:4px}
        .metric-valor{flex:1.5}

        /* Import panel */
        .import-panel{background:var(--surface);border-bottom:2px solid var(--accent);padding:20px 24px}
        .panel-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)}
        .import-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px}
        .import-col{}
        .import-label{font-family:var(--font-mono);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
        .drop-zone{display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--border);padding:24px;cursor:pointer;transition:border-color .15s;min-height:100px}
        .drop-zone:hover{border-color:var(--accent)}
        .drop-icon{font-size:24px;margin-bottom:8px}
        .drop-txt{font-size:12px;color:var(--text2)}
        .drop-hint{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:4px}
        .file-ok{font-size:11px;color:var(--green);margin-top:8px;font-family:var(--font-mono)}
        .map-empty{font-size:12px;color:var(--muted);font-style:italic}
        .map-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
        .map-lbl{font-size:11px;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .map-arr{color:var(--muted);font-size:12px}
        .map-sel{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 8px;font-size:11px;flex:1.2}
        .import-footer{display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border)}
        .import-info{font-family:var(--font-mono);font-size:10px;letter-spacing:1px;color:var(--muted)}

        /* Revisão */
        .rev-hint{font-size:11px;color:var(--text2);margin-bottom:12px}
        .rev-wrap{overflow-x:auto;max-height:340px;overflow-y:auto;margin-bottom:12px}
        .rev-table{width:100%;border-collapse:collapse;font-size:11px;min-width:800px}
        .rev-table thead tr{background:var(--surface2);position:sticky;top:0;z-index:2}
        .rev-table th{padding:8px 10px;text-align:left;font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
        .rev-table td{padding:4px 6px;border-bottom:1px solid var(--border)}
        .rev-num{font-family:var(--font-mono);font-size:9px;color:var(--muted);width:28px;text-align:center}
        .rev-input{width:100%;padding:5px 7px;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text);font-size:11px}
        .rev-input:focus{outline:1px solid var(--accent);background:oklch(from var(--accent) l c h / 0.06)}
        .rev-vazio{border-color:rgba(249,115,22,.5)}

        /* Toolbar */
        .toolbar{display:flex;align-items:center;gap:8px;padding:12px 24px;background:var(--surface);border-bottom:1px solid var(--border)}
        .search-input{flex:1;max-width:400px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;font-size:12px;transition:border-color .15s}
        .search-input:focus{outline:none;border-color:var(--accent)}
        .loading-txt{font-family:var(--font-mono);font-size:9px;color:var(--muted);letter-spacing:2px}
        .result-count{margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--muted);letter-spacing:2px}

        /* Filter panel */
        .filter-panel{background:var(--surface2);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;gap:16px;flex-wrap:wrap}
        .filter-group{display:flex;flex-direction:column;gap:4px;min-width:180px}
        .filter-group label{font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
        .filter-group input,.filter-group select{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:6px 10px;font-size:11px}
        .filter-group input:focus,.filter-group select:focus{outline:none;border-color:var(--accent)}
        .filter-group select option{background:var(--surface)}

        /* Tabela */
        .tbl-wrap{overflow-x:auto;padding:0 24px 24px}
        .tbl{width:100%;border-collapse:collapse;font-size:12px;margin-top:0}
        .tbl thead tr{border-bottom:1px solid var(--border)}
        .tbl th{padding:10px 12px;text-align:left;font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);background:var(--bg)}
        .tbl-row td{padding:12px;border-bottom:1px solid var(--border);vertical-align:middle;background:transparent;transition:background .1s}
        .tbl-row:hover td{background:var(--surface)}
        .id-cell{font-family:var(--font-mono);font-size:10px;color:var(--muted);white-space:nowrap}
        .cell-primary{font-weight:500;color:var(--text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cell-sec{color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
        .cell-mono{font-family:var(--font-mono);font-size:11px;color:var(--text2);white-space:nowrap}
        .cell-empty{color:var(--muted);font-style:italic}
        .cell-actions{white-space:nowrap;display:flex;gap:4px}
        .status-pill{display:inline-flex;padding:3px 10px;font-family:var(--font-mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;font-weight:700;border:1px solid;white-space:nowrap}
        .act-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:3px 9px;font-size:10px;cursor:pointer;font-family:var(--font-mono);letter-spacing:1px;transition:all .15s}
        .act-btn:hover{border-color:var(--accent);color:var(--accent)}
        .act-btn.danger:hover{border-color:var(--danger);color:var(--danger)}
        .empty-row{text-align:center;padding:40px;color:var(--muted);font-size:12px;background-image:repeating-linear-gradient(-58deg,transparent 0 11px,oklch(0.656 0.231 29.3 / 4%) 11px 12px)}

        /* Modal */
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:200;padding:24px}
        .modal{background:var(--surface);border:1px solid var(--border);border-top:2px solid var(--accent);width:100%;max-width:640px;max-height:90vh;display:flex;flex-direction:column}
        .modal-hdr{padding:20px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0}
        .modal-eyebrow{font-family:var(--font-mono);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
        .modal-title{font-size:18px;font-weight:700;color:var(--signal)}
        .modal-close{background:none;border:1px solid var(--border);color:var(--text2);width:28px;height:28px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .modal-close:hover{border-color:var(--danger);color:var(--danger)}
        .modal-body{padding:20px 24px;overflow-y:auto;flex:1}
        .modal-section{font-family:var(--font-mono);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--accent);margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--border)}
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .fg{display:flex;flex-direction:column;gap:4px}
        .fg.full{grid-column:1/-1}
        .fg label{font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
        .fg input,.fg select,.fg textarea{background:#13161F;border:1px solid #1E2130;color:var(--text);padding:8px 10px;font-size:12px;transition:border-color .15s}
        .fg textarea{resize:vertical;min-height:80px}
        .fg input:focus,.fg select:focus,.fg textarea:focus{outline:none;border-color:var(--accent)}
        .fg select option{background:var(--surface)}
        .hist-list{list-style:none;margin-bottom:8px}
        .hist-item{padding:6px 10px;font-size:11px;color:var(--text2);border-left:2px solid var(--border);margin-bottom:4px;font-family:var(--font-mono)}
        .hist-input{width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;font-size:12px}
        .hist-input:focus{outline:none;border-color:var(--accent)}
        .modal-foot{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}

        /* Toast */
        .toast{position:fixed;bottom:24px;right:24px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);color:var(--text);padding:12px 20px;font-size:12px;opacity:0;transform:translateY(10px);transition:all .25s;pointer-events:none;z-index:999}
        .toast.show{opacity:1;transform:translateY(0)}

        @media(max-width:768px){.import-grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.metrics-bar{flex-wrap:wrap}}
        .btn-avancar{background:transparent;border:1px solid;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;transition:all .15s;text-align:left}
        .btn-avancar:hover{opacity:.8}
        .status-atual-pill{}

        /* Anexos */
        .anexos-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:10px}
        .btn-anexar{display:inline-flex;align-items:center;padding:7px 14px;background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:11px;cursor:pointer;transition:all .15s;font-family:var(--font-display)}
        .btn-anexar:hover{border-color:var(--accent);color:var(--accent)}
        .anexo-hint{font-size:10px;color:var(--muted);font-family:var(--font-mono)}
        .anexos-empty{font-size:11px;color:var(--muted);font-style:italic;padding:12px;text-align:center;border:1px dashed var(--border)}
        .anexos-list{display:flex;flex-direction:column;gap:6px}
        .anexo-row{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border:1px solid var(--border)}
        .anexo-icon{font-size:18px;flex-shrink:0}
        .anexo-info{flex:1;min-width:0}
        .anexo-nome{font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .anexo-meta{font-size:10px;color:var(--muted);font-family:var(--font-mono);margin-top:2px}
        .anexo-actions{display:flex;gap:4px;flex-shrink:0}

        /* Parcelas */
        .parcelas-toolbar{margin-bottom:12px;display:flex;flex-direction:column;gap:8px}
        .parcela-input-qtd{width:140px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:6px 10px;font-size:12px}
        .parcela-input-qtd:focus{outline:none;border-color:var(--accent)}
        .btn-parcela-gerar{background:var(--accent);color:#fff;border:none;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
        .btn-parcela-gerar:hover{background:color-mix(in oklch, var(--accent) 85%, black)}
        .btn-parcela-add{background:transparent;border:1px solid var(--border);color:var(--text2);padding:6px 14px;font-size:12px;cursor:pointer;transition:all .15s}
        .btn-parcela-add:hover{border-color:var(--accent);color:var(--accent)}
        .parcela-hint{font-size:11px;color:var(--muted)}
        .parcelas-resumo{font-family:var(--font-mono);font-size:10px;letter-spacing:1px;color:var(--muted);padding:6px 10px;background:var(--surface2);border-left:2px solid var(--accent)}
        .parcelas-wrap{overflow-x:auto;max-height:300px;overflow-y:auto;border:1px solid var(--border)}
        .parcelas-table{width:100%;border-collapse:collapse;font-size:12px;min-width:500px}
        .parcelas-table thead tr{background:var(--surface2);position:sticky;top:0}
        .parcelas-table th{padding:8px 10px;text-align:left;font-family:var(--font-mono);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)}
        .parcela-row td{padding:4px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
        .parcela-row.parcela-pago td{opacity:.6}
        .parcela-num{font-family:var(--font-mono);font-size:10px;color:var(--muted);width:28px;text-align:center}
        .parcela-field{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text);padding:5px 7px;font-size:11px}
        .parcela-field:focus{outline:none;border-color:var(--accent)}
        .parcela-status{background:var(--surface2);border:1px solid var(--border);font-size:10px;padding:4px 6px;cursor:pointer;font-weight:600}
        .parcela-status.status-pago{color:var(--green);border-color:rgba(34,197,94,.3)}
        .parcela-status.status-pendente{color:var(--text2)}
        .parcela-del{background:none;border:1px solid var(--border);color:var(--muted);width:24px;height:24px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;transition:all .15s}
        .parcela-del:hover{border-color:var(--danger);color:var(--danger)}
        .parcelas-empty{font-size:11px;color:var(--muted);font-style:italic;padding:16px;text-align:center;border:1px dashed var(--border)}
      `}</style>
    </>
  );
}
