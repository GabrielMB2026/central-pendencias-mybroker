import { useEffect, useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

/* ── Parser ERP ── */
function parseCamposERP(raw) {
  const s = String(raw || '').trim();
  const result = { pagador:'', proposta:'', empreendimento:'', unidade:'', statusVenda:'', confianca:'baixa' };
  if (!s) return result;
  let limpo = s.replace(/^Recebimentos\s*\[[^\]]*\]\s*-?\s*/i,'').trim().replace(/`/g,'').trim();
  if (!limpo) return result;
  let statusVenda = '';
  const vm = limpo.match(/VENDA\s+NA\s+ABA[:\-]?\s*(.+)$/i);
  if (vm) { statusVenda = 'Venda na aba: ' + vm[1].trim(); limpo = limpo.slice(0,vm.index).trim(); }
  const pm = limpo.match(/\(([^)]+)\)\s*$/);
  if (pm) { statusVenda = (statusVenda ? statusVenda+' · ':'')+pm[1].trim(); limpo = limpo.slice(0,pm.index).trim(); }
  result.statusVenda = statusVenda;
  limpo = limpo.replace(/[-\/]\s*$/,'').trim();
  if (!limpo) return result;
  let unidade = '';
  const um = limpo.match(/^(.*?)\s*-?\s*(Unidade\s+.*?(?:Bl\/?Qd\s*[\w\-]*)?)\s*$/i);
  if (um && um[2]) { unidade = um[2].trim(); limpo = um[1].trim(); }
  result.unidade = unidade;
  limpo = limpo.replace(/[-\/]\s*$/,'').trim();
  const mProp = limpo.match(/^proposta\s*[:\-]?\s*(\d+)\s*$/i);
  if (mProp) { result.proposta = mProp[1]; result.confianca = 'alta'; return result; }
  const blocos = limpo.split(/\s+-\s+/).map(b=>b.trim()).filter(Boolean);
  if (!blocos.length) return result;
  function extraiProposta(bloco) {
    let m = bloco.match(/^(.*?)[\/]\s*(\d{5,})\s*$/);
    if (m) return { nome:m[1].trim(), prop:m[2] };
    m = bloco.match(/^(.*?)\s+(\d{5,})\s*$/);
    if (m) return { nome:m[1].trim(), prop:m[2] };
    m = bloco.match(/^(\d{5,})\s*$/);
    if (m) return { nome:'', prop:m[1] };
    m = bloco.match(/^proposta\s*[:\-]?\s*(\d+)\s*(.*)$/i);
    if (m) return { nome:m[2]?m[2].trim():'', prop:m[1] };
    return null;
  }
  const ep0 = extraiProposta(blocos[0]);
  if (ep0 && ep0.nome) { result.pagador=ep0.nome; result.proposta=ep0.prop; result.confianca='alta'; }
  else if (ep0 && !ep0.nome) { result.proposta=ep0.prop; result.confianca='media'; }
  else if (/^proposta$/i.test(blocos[0])) { result.confianca='baixa'; }
  else { result.pagador=blocos[0]; result.confianca='media'; }
  for (let i=1;i<blocos.length;i++) {
    const epi = extraiProposta(blocos[i]);
    if (epi) { if(epi.prop&&!result.proposta)result.proposta=epi.prop; if(epi.nome&&!result.empreendimento)result.empreendimento=epi.nome; continue; }
    if (/^proposta$/i.test(blocos[i])) continue;
    if (!result.empreendimento) result.empreendimento=blocos[i]; else result.empreendimento+=' · '+blocos[i];
  }
  if (!result.pagador&&!result.empreendimento&&!result.proposta) { result.pagador=blocos.join(' - '); result.confianca='baixa'; }
  return result;
}

function extrairObsERP(raw) {
  const r = parseCamposERP(raw);
  return [r.unidade, r.statusVenda].filter(Boolean).join(' · ');
}

const CAMPOS_DESTINO = [
  { key:'ccusto', label:'C.Custo / Loja' },
  { key:'contrato', label:'Contrato (texto rico — será separado automaticamente)' },
  { key:'descricao', label:'Descrição (obs)' },
  { key:'pagador', label:'Pagador (já separado)' },
  { key:'empreendimento', label:'Empreendimento (já separado)' },
  { key:'proposta', label:'Proposta (já separado)' },
  { key:'data', label:'Data Receb.' },
  { key:'valor', label:'Valor' },
  { key:'ignorar', label:'— Ignorar —' },
];

const HEURISTICS = {
  ccusto:['c.custo','ccusto','centro','custo','loja','setor','cc'],
  contrato:['contrato'],
  descricao:['descri','desc'],
  pagador:['pagador'],
  empreendimento:['empreend','empreendimento','imovel','produto'],
  proposta:['proposta','venda','numdoc','documento'],
  data:['data','date','receb','venc'],
  valor:['valor','value','total','vlr','vl'],
};

const COLUNAS_IGNORAR_EXATAS = ['mes','ano','mes/ano','cliente','tipo','status'];

function guessField(col) {
  const lc = col.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (COLUNAS_IGNORAR_EXATAS.includes(lc)) return 'ignorar';
  for (const [k,kws] of Object.entries(HEURISTICS)) if (kws.some(kw=>lc.includes(kw))) return k;
  return 'ignorar';
}

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

function fmt(v) { return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function badge(s) { const m={Pendente:'bp','Em andamento':'ba',Atrasada:'bat',Resolvida:'br'}; return {cls:m[s]||'bp',label:s}; }
function nextId(existing) {
  let max=0;
  existing.forEach(p=>{const m=String(p.id).match(/PND-(\d+)/);if(m)max=Math.max(max,parseInt(m[1],10));});
  return 'PND-'+String(max+1).padStart(3,'0');
}

// ── Utilitários de SLA de resolução ──
// IMPORTANTE: a "Data Receb." é a data em que o valor já caiu na conta
// (recebimento confirmado) — não é prazo de vencimento. A pendência aqui
// é o trabalho de identificação/regularização que a equipe precisa fazer.
// O SLA, portanto, é sobre prazo de RESPOSTA da equipe, contado a partir
// da criação (ou última tratativa) da pendência — padrão configurável,
// hoje fixado em 1 dia útil.

const SLA_PADRAO_DIAS = 1; // prazo padrão para o responsável dar retorno

// Converte "DD/MM" (sem ano, como aparece no histórico) em Date,
// assumindo o ano corrente. Usado só para cálculos internos de SLA.
function parseDataCurta(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const anoAtual = new Date().getFullYear();
  const dt = new Date(anoAtual, parseInt(m[2],10)-1, parseInt(m[1],10));
  return isNaN(dt.getTime()) ? null : dt;
}

// Data da última movimentação registrada no histórico (criação ou tratativa mais recente)
function dataUltimaMovimentacao(historico) {
  if (!historico || !historico.length) return null;
  return parseDataCurta(historico[historico.length - 1]);
}

// Data de criação (primeira linha do histórico)
function dataCriacaoDoHistorico(historico) {
  if (!historico || !historico.length) return null;
  return parseDataCurta(historico[0]);
}

// Data em que a pendência foi marcada como Resolvida (procura no histórico)
function dataResolucaoDoHistorico(historico) {
  if (!historico || !historico.length) return null;
  for (let i = historico.length - 1; i >= 0; i--) {
    if (/resolvid/i.test(String(historico[i]))) return parseDataCurta(historico[i]);
  }
  return null;
}

// Quantos dias se passaram desde a última movimentação (criação ou tratativa)
function diasDesdeUltimaMovimentacao(p) {
  const dt = dataUltimaMovimentacao(p.historico) || dataCriacaoDoHistorico(p.historico);
  if (!dt) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  dt.setHours(0,0,0,0);
  return Math.round((hoje - dt) / 86400000);
}

// Determina o status "efetivo": se a pendência está aberta (não resolvida)
// e já passou do prazo de SLA sem nova movimentação, considera Atrasada
// automaticamente — sem precisar marcar manualmente.
function statusEfetivo(p) {
  if (p.status === 'Resolvida') return 'Resolvida';
  const dias = diasDesdeUltimaMovimentacao(p);
  if (dias !== null && dias > SLA_PADRAO_DIAS) return 'Atrasada';
  return p.status;
}

// Calcula SLA médio real (em dias) das pendências já resolvidas:
// tempo entre a criação e a marcação como Resolvida.
function calcularSlaMedia(pendencias) {
  const tempos = [];
  pendencias.filter(p => p.status === 'Resolvida').forEach(p => {
    const inicio = dataCriacaoDoHistorico(p.historico);
    const fim = dataResolucaoDoHistorico(p.historico);
    if (inicio && fim) {
      const dias = Math.round((fim - inicio) / 86400000);
      if (dias >= 0) tempos.push(dias);
    }
  });
  if (!tempos.length) return null;
  return Math.round((tempos.reduce((a,b)=>a+b,0) / tempos.length) * 10) / 10;
}

export default function Home({ sessao }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const isAdmin = perfil?.role === 'admin';

  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTipo, setFTipo] = useState('');

  const [selecionados, setSelecionados] = useState(new Set());
  const [deletandoLote, setDeletandoLote] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [detectedCols, setDetectedCols] = useState([]);
  const [importedRows, setImportedRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [previewRows, setPreviewRows] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [histNew, setHistNew] = useState('');

  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(''),3500);
  },[]);

  // ── Carrega perfil do usuário logado ──
  useEffect(() => {
    if (!sessao) return;
    supabase.from('user_profiles').select('*').eq('id',sessao.user.id).single()
      .then(({data}) => setPerfil(data));
  },[sessao]);

  const loadPendencias = useCallback(async () => {
    setLoading(true); setErro('');
    const {data,error} = await supabase.from('pendencias').select('*').order('created_at',{ascending:true});
    if (error) { setErro('Erro ao carregar: '+error.message); setLoading(false); return; }
    setPendencias((data||[]).map(row=>({
      id:row.id, loja:row.loja||'', pagador:row.pagador||'',
      empreendimento:row.empreendimento||'', proposta:row.proposta||'',
      dataReceb:row.data_receb||'', valor:Number(row.valor)||0,
      tipo:row.tipo||'Documentação', status:row.status||'Pendente',
      responsavel:row.responsavel||'', acao:row.acao||'', obs:row.obs||'',
      historico:Array.isArray(row.historico)?row.historico:[],
      origem:row.origem||'manual', confianca:row.confianca||null,
    })));
    setSelecionados(new Set());
    setLoading(false);
  },[]);

  useEffect(()=>{ loadPendencias(); },[loadPendencias]);

  const filtered = pendencias.filter(p=>{
    const b=busca.toLowerCase();
    const bOk=!b||[p.pagador,p.empreendimento,p.proposta,p.loja,p.id].some(x=>(x||'').toLowerCase().includes(b));
    return bOk&&(!fStatus||statusEfetivo(p)===fStatus)&&(!fTipo||p.tipo===fTipo);
  });

  const metrics = {
    total:pendencias.length,
    pend:pendencias.filter(p=>statusEfetivo(p)==='Pendente').length,
    and:pendencias.filter(p=>statusEfetivo(p)==='Em andamento').length,
    atr:pendencias.filter(p=>statusEfetivo(p)==='Atrasada').length,
    res:pendencias.filter(p=>p.status==='Resolvida').length,
    val:pendencias.reduce((a,p)=>a+Number(p.valor),0),
    slaMedia: calcularSlaMedia(pendencias),
  };

  // ── Seleção múltipla ──
  const todosVisivelsSelecionados = filtered.length>0&&filtered.every(p=>selecionados.has(p.id));
  function toggleSelecionado(id) {
    setSelecionados(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  }
  function toggleTodos() {
    if (todosVisivelsSelecionados) setSelecionados(prev=>{ const n=new Set(prev); filtered.forEach(p=>n.delete(p.id)); return n; });
    else setSelecionados(prev=>{ const n=new Set(prev); filtered.forEach(p=>n.add(p.id)); return n; });
  }
  async function deletarSelecionados() {
    const ids=Array.from(selecionados);
    if (!ids.length||!confirm(`Excluir ${ids.length} pendência(s)?`)) return;
    setDeletandoLote(true);
    const {error}=await supabase.from('pendencias').delete().in('id',ids);
    setDeletandoLote(false);
    if (error){showToast('Erro: '+error.message);return;}
    await loadPendencias();
    showToast(`${ids.length} pendência(s) excluída(s).`);
  }
  async function deletar(id) {
    if (!confirm('Excluir a pendência '+id+'?')) return;
    const {error}=await supabase.from('pendencias').delete().eq('id',id);
    if (error){showToast('Erro: '+error.message);return;}
    await loadPendencias(); showToast('Pendência removida.');
  }

  // ── Importação CSV (lê como texto puro para preservar datas) ──
  function handleFile(e) {
    const file=e.target.files[0]; if(!file) return;
    setFileName(file.name);
    const isCsv=file.name.toLowerCase().endsWith('.csv');
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const bytes=new Uint8Array(ev.target.result);
      if (isCsv) {
        let texto=new TextDecoder('utf-8').decode(bytes);
        if (/Ã[£¢§¡©ª«¬­®°±²³´µ¶·¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿƒ]/.test(texto)) {
          texto=new TextDecoder('windows-1252').decode(bytes);
        }
        parseCsvTexto(texto);
      } else {
        const wb=XLSX.read(bytes,{type:'array',raw:true,cellDates:false});
        processWorkbook(wb);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseCsvTexto(texto) {
    const linhas=[]; let campo='',campos=[],dentroAspas=false;
    for (let i=0;i<texto.length;i++) {
      const c=texto[i];
      if (c==='"') { if(dentroAspas&&texto[i+1]==='"'){campo+='"';i++;}else dentroAspas=!dentroAspas; }
      else if (c===','&&!dentroAspas) { campos.push(campo);campo=''; }
      else if ((c==='\n'||c==='\r')&&!dentroAspas) {
        campos.push(campo);campo='';
        if(campos.some(f=>f.trim()))linhas.push(campos);
        campos=[];if(c==='\r'&&texto[i+1]==='\n')i++;
      } else campo+=c;
    }
    if(campo||campos.length){campos.push(campo);if(campos.some(f=>f.trim()))linhas.push(campos);}
    if(linhas.length<2){alert('Arquivo vazio.');return;}
    finalizarImport(linhas[0].map(String), linhas.slice(1).filter(r=>r.some(c=>String(c).trim()!=='')), linhas.slice(1,6));
  }

  function processWorkbook(wb) {
    const ws=wb.Sheets[wb.SheetNames[0]];
    const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    if(!json||json.length<2){alert('Arquivo vazio.');return;}
    finalizarImport(json[0].map(String), json.slice(1).filter(r=>r.some(c=>String(c).trim()!=='')), json.slice(1,6));
  }

  function finalizarImport(cols, rows, preview) {
    setDetectedCols(cols); setImportedRows(rows); setPreviewRows(preview);
    const m={}; cols.forEach((col,i)=>{m[i]=guessField(col);}); setMapping(m);
  }

  function getMappingByField() {
    const m={};
    Object.entries(mapping).forEach(([idx,field])=>{if(field!=='ignorar')m[field]=parseInt(idx,10);});
    return m;
  }

  async function doImport() {
    const map=getMappingByField(); setSaving(true);
    const dateStr=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const nomeResponsavel=perfil?.nome||sessao?.user?.email||'Sistema';
    const novas=[]; let seed=[...pendencias];
    importedRows.forEach(row=>{
      const cRaw=map.contrato!==undefined?String(row[map.contrato]||''):'';
      const descRaw=map.descricao!==undefined?String(row[map.descricao]||''):'';
      const parsed=parseCamposERP(cRaw);
      const obsAuto=extrairObsERP(cRaw);
      const obs=[descRaw,obsAuto,cRaw?'Texto original ERP: '+cRaw:''].filter(Boolean).join(' · ');
      const newId=nextId(seed);
      const nova={
        id:newId, loja:map.ccusto!==undefined?String(row[map.ccusto]||''):'',
        pagador:map.pagador!==undefined?String(row[map.pagador]||''):parsed.pagador,
        empreendimento:map.empreendimento!==undefined?String(row[map.empreendimento]||''):parsed.empreendimento,
        proposta:map.proposta!==undefined?String(row[map.proposta]||''):parsed.proposta,
        dataReceb:map.data!==undefined?parseData(row[map.data]):'',
        valor:map.valor!==undefined?parseValor(row[map.valor]):0,
        tipo:'Documentação', status:'Pendente', responsavel:'', acao:'A definir', obs,
        historico:[`${dateStr} - Importado do ERP por ${nomeResponsavel} (confiança: ${parsed.confianca})`],
        origem:'erp', confianca:parsed.confianca,
      };
      novas.push(nova); seed=[...seed,nova];
    });
    const {error}=await supabase.from('pendencias').insert(novas.map(p=>({
      id:p.id,loja:p.loja,pagador:p.pagador,empreendimento:p.empreendimento,
      proposta:p.proposta,data_receb:p.dataReceb,valor:p.valor,tipo:p.tipo,
      status:p.status,responsavel:p.responsavel,acao:p.acao,obs:p.obs,
      historico:p.historico,origem:p.origem,confianca:p.confianca,
    })));
    setSaving(false);
    if(error){showToast('Erro ao importar: '+error.message);return;}
    await loadPendencias();
    setImportOpen(false);setDetectedCols([]);setImportedRows([]);setPreviewRows([]);setFileName('');
    if(fileInputRef.current)fileInputRef.current.value='';
    const rev=novas.filter(p=>p.confianca==='media'||p.confianca==='baixa').length;
    showToast(novas.length+' importada(s)! '+(rev?rev+' precisam revisão.':''));
  }

  // ── Modal ──
  function openModal(id) {
    setEditingId(id);
    if(id){const p=pendencias.find(x=>x.id===id);setForm({...p});}
    else setForm({loja:'',status:'Pendente',pagador:'',empreendimento:'',proposta:'',dataReceb:'',valor:'',tipo:'Documentação',responsavel:perfil?.nome||'',acao:'',obs:'',historico:[]});
    setHistNew('');setModalOpen(true);
  }
  function closeModal(){setModalOpen(false);setEditingId(null);}

  async function savePendencia() {
    setSaving(true);
    const nomeResponsavel=perfil?.nome||sessao?.user?.email||'Sistema';
    const resp=(form.responsavel||'').trim()||nomeResponsavel;
    const dateStr=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    if(editingId){
      const existing=pendencias.find(p=>p.id===editingId);
      const novoHist=[...(existing.historico||[])];
      const mudouParaResolvida = existing.status!=='Resolvida' && form.status==='Resolvida';
      if (mudouParaResolvida) {
        novoHist.push(`${dateStr} - Marcado como Resolvida por ${nomeResponsavel}${histNew?' — '+histNew:''}`);
      } else {
        novoHist.push(histNew?`${dateStr} - ${histNew} (${nomeResponsavel})`:`${dateStr} - Atualizado por ${nomeResponsavel}`);
      }
      const {error}=await supabase.from('pendencias').update({
        loja:form.loja||'',pagador:form.pagador||'',empreendimento:form.empreendimento||'',
        proposta:form.proposta||'',data_receb:form.dataReceb||'',valor:parseFloat(form.valor)||0,
        tipo:form.tipo||'Documentação',status:form.status||'Pendente',responsavel:resp,
        acao:form.acao||'',obs:form.obs||'',historico:novoHist,
      }).eq('id',editingId);
      setSaving(false);
      if(error){showToast('Erro: '+error.message);return;}
    } else {
      const newId=nextId(pendencias);
      const {error}=await supabase.from('pendencias').insert({
        id:newId,loja:form.loja||'',pagador:form.pagador||'',empreendimento:form.empreendimento||'',
        proposta:form.proposta||'',data_receb:form.dataReceb||'',valor:parseFloat(form.valor)||0,
        tipo:form.tipo||'Documentação',status:form.status||'Pendente',responsavel:resp,
        acao:form.acao||'',obs:form.obs||'',
        historico:[`${dateStr} - Criado por ${nomeResponsavel}`],origem:'manual',
      });
      setSaving(false);
      if(error){showToast('Erro: '+error.message);return;}
    }
    await loadPendencias();closeModal();showToast('Pendência salva!');
  }

  function exportExcel(){
    if(!pendencias.length){alert('Nenhuma pendência para exportar.');return;}
    const rows=pendencias.map(p=>({ID:p.id,Origem:p.origem==='erp'?'ERP':'Manual','C.Custo / Loja':p.loja,Pagador:p.pagador,Empreendimento:p.empreendimento,'Proposta / Contrato':p.proposta,'Data Receb.':p.dataReceb,'Valor (R$)':p.valor,Tipo:p.tipo,Status:p.status,Responsável:p.responsavel,'Próxima Ação':p.acao,Observações:p.obs,Histórico:(p.historico||[]).join(' | ')}));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws['!cols']=[{wch:10},{wch:8},{wch:30},{wch:26},{wch:24},{wch:16},{wch:12},{wch:14},{wch:14},{wch:14},{wch:20},{wch:32},{wch:42},{wch:60}];
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Pendências');
    XLSX.writeFile(wb,'Central_Pendencias_MyBroker_'+new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')+'.xlsx');
  }

  async function handleLogout(){
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <>
      <Head>
        <title>Central de Pendências · My Broker CSC Financeiro</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      {/* HEADER */}
      <div className="header">
        <div className="logo-area">
          <div className="logo-mark"><span>MB</span></div>
          <div>
            <div className="header-eyebrow">CSC Financeiro · Contas a Receber</div>
            <div className="header-name">Central de Pendências</div>
          </div>
        </div>
        <div className="header-actions">
          {isAdmin && <button className="chip" onClick={()=>setImportOpen(v=>!v)}>↓ Importar ERP</button>}
          <button className="chip" onClick={exportExcel}>↑ Exportar Excel</button>
          {isAdmin && <button className="chip chip-yellow" onClick={()=>openModal(null)}>+ Nova Pendência</button>}
          {/* Usuário logado */}
          <div className="user-pill">
            <span className="user-nome">{perfil?.nome||sessao?.user?.email}</span>
            <span className={'user-role '+(isAdmin?'role-admin':'role-editor')}>{isAdmin?'admin':'editor'}</span>
            {isAdmin && <button className="user-btn" onClick={()=>router.push('/admin')} title="Gerenciar usuários">⚙</button>}
            <button className="user-btn" onClick={()=>router.push('/dashboard')} title="Dashboard">📊</button>
            <button className="user-btn" onClick={handleLogout} title="Sair">⏻</button>
          </div>
        </div>
      </div>

      {erro && <div style={{background:'#FEE2E2',color:'#991B1B',padding:'10px 24px',fontSize:12}}>{erro}</div>}

      {/* IMPORT PANEL — só admin */}
      {isAdmin && (
        <div className={'import-panel'+(importOpen?' open':'')}>
          <div className="import-eyebrow">Importação via planilha</div>
          <div className="import-title">Importar Lançamentos do ERP</div>
          <div className="import-grid">
            <div className="import-card">
              <div className="import-card-num">01</div>
              <div className="import-card-label">Selecionar arquivo</div>
              <div className="drop-zone">
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
                <div className="drop-icon">📁</div>
                <div className="drop-txt">Arraste ou clique para selecionar</div>
                <div className="drop-hint">.xlsx · .xls · .csv</div>
              </div>
              {fileName && <div className="file-ok" style={{display:'block'}}>✓ {fileName}</div>}
            </div>
            <div className="import-card">
              <div className="import-card-num">02</div>
              <div className="import-card-label">Mapeamento de colunas</div>
              {detectedCols.length===0 ? <div className="map-empty">Carregue um arquivo para configurar</div> : (
                detectedCols.map((col,i)=>(
                  <div className="map-row" key={i}>
                    <div className="map-lbl" title={col}>{col}</div>
                    <div className="map-arr">→</div>
                    <select className="map-sel" value={mapping[i]||'ignorar'} onChange={e=>setMapping(m=>({...m,[i]:e.target.value}))}>
                      {CAMPOS_DESTINO.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))
              )}
            </div>
          </div>
          {previewRows.length>0 && (
            <div className="preview-wrap" style={{display:'block'}}>
              <div className="preview-eyebrow">Pré-visualização — primeiras 5 linhas</div>
              <div className="preview-scroll">
                <table className="ptbl">
                  <thead><tr>{detectedCols.map((c,i)=><th key={i}>{c}</th>)}</tr></thead>
                  <tbody>{previewRows.map((r,ri)=><tr key={ri}>{detectedCols.map((_,ci)=><td key={ci}>{String(r[ci]||'')}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          <div className="import-footer">
            <div className="import-info">{importedRows.length>0?`${importedRows.length} linha(s) · ${detectedCols.length} coluna(s)`:''}</div>
            <div style={{display:'flex',gap:6}}>
              <button className="chip" onClick={()=>setImportOpen(false)}>Cancelar</button>
              {importedRows.length>0 && <button className="chip chip-yellow" onClick={doImport} disabled={saving}>{saving?'Importando...':'✓ Importar pendências'}</button>}
            </div>
          </div>
        </div>
      )}

      {/* METRICS */}
      <div className="metrics-section">
        <div className="metrics-eyebrow">Visão geral · clique em um status para filtrar</div>
        <div className="metrics">
          <div className={'metric total clickable'+(fStatus===''?' active':'')} onClick={()=>setFStatus('')} title="Mostrar todos os status">
            <div className="metric-num">∑</div><div className="metric-lbl">Total</div><div className="metric-val">{metrics.total}</div>
          </div>
          <div className={'metric pend clickable'+(fStatus==='Pendente'?' active':'')} onClick={()=>setFStatus(fStatus==='Pendente'?'':'Pendente')} title="Filtrar por Pendente">
            <div className="metric-num">P</div><div className="metric-lbl">Pendentes</div><div className="metric-val yellow">{metrics.pend}</div>
          </div>
          <div className={'metric and clickable'+(fStatus==='Em andamento'?' active':'')} onClick={()=>setFStatus(fStatus==='Em andamento'?'':'Em andamento')} title="Filtrar por Em andamento">
            <div className="metric-num">A</div><div className="metric-lbl">Em andamento</div><div className="metric-val">{metrics.and}</div>
          </div>
          <div className={'metric atr clickable'+(fStatus==='Atrasada'?' active':'')} onClick={()=>setFStatus(fStatus==='Atrasada'?'':'Atrasada')} title="Filtrar por Atrasada (sem retorno dentro do SLA)">
            <div className="metric-num">!</div><div className="metric-lbl">Atrasadas</div><div className="metric-val danger">{metrics.atr}</div>
          </div>
          <div className={'metric res clickable'+(fStatus==='Resolvida'?' active':'')} onClick={()=>setFStatus(fStatus==='Resolvida'?'':'Resolvida')} title="Filtrar por Resolvida">
            <div className="metric-num">✓</div><div className="metric-lbl">Resolvidas</div><div className="metric-val green">{metrics.res}</div>
          </div>
          <div className="metric sla">
            <div className="metric-num">⏱</div><div className="metric-lbl">SLA Médio</div><div className="metric-val sm">{metrics.slaMedia !== null ? metrics.slaMedia + ' dias' : '—'}</div>
          </div>
          <div className="metric val">
            <div className="metric-num">R$</div><div className="metric-lbl">Valor Total</div><div className="metric-val sm">{fmt(metrics.val)}</div>
          </div>
        </div>
      </div>
      <div className="sla-hint">SLA padrão: {SLA_PADRAO_DIAS} dia útil para retorno do responsável · Atrasada = sem nova movimentação dentro do prazo · SLA Médio = tempo real até a resolução</div>


      {/* TOOLBAR */}
      <div className="toolbar">
        <input className="fld" type="text" placeholder="Buscar pagador, empreendimento, proposta, ID..." value={busca} onChange={e=>setBusca(e.target.value)} />
        <select className="fld" value={fStatus} onChange={e=>setFStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option>Pendente</option><option>Em andamento</option><option>Atrasada</option><option>Resolvida</option>
        </select>
        <select className="fld" value={fTipo} onChange={e=>setFTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option>Documentação</option><option>Pagamento</option><option>Assinatura</option><option>Vistoria</option><option>Outro</option>
        </select>
        {loading && <span style={{color:'rgba(255,255,255,.5)',fontSize:11,fontFamily:"'DM Mono',monospace"}}>carregando…</span>}
      </div>

      {/* BULK ACTION BAR */}
      {isAdmin && selecionados.size>0 && (
        <div className="bulk-bar">
          <div className="bulk-info">
            <div className="bulk-count">{selecionados.size}</div>
            <span>selecionada{selecionados.size>1?'s':''}</span>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="chip" onClick={()=>setSelecionados(new Set())}>Cancelar</button>
            <button className="chip chip-danger" onClick={deletarSelecionados} disabled={deletandoLote}>
              {deletandoLote?'Excluindo...':'🗑 Excluir '+selecionados.size}
            </button>
          </div>
        </div>
      )}

      {/* TABLE */}
      <div className="tbl-section">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                {isAdmin && <th style={{width:40,textAlign:'center'}}><input type="checkbox" className="cb" checked={todosVisivelsSelecionados} onChange={toggleTodos}/></th>}
                <th>ID</th><th>C.Custo / Loja</th><th>Pagador</th><th>Empreendimento</th>
                <th>Proposta</th><th>Data Receb.</th><th>Valor</th>
                <th>Status</th><th>Responsável</th><th>Próxima Ação</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr className="empty-row">
                  <td colSpan={isAdmin?12:11}>
                    {loading?'Carregando...':pendencias.length===0?'Nenhuma pendência cadastrada':'Nenhum resultado para os filtros'}
                  </td>
                </tr>
              ) : filtered.map(p=>{
                const statusReal = statusEfetivo(p);
                const b=badge(statusReal);
                const sel=selecionados.has(p.id);
                // Dias desde a última movimentação — base do SLA de resposta (não é vencimento de pagamento)
                const diasParado = p.status!=='Resolvida' ? diasDesdeUltimaMovimentacao(p) : null;
                const estourouSla = diasParado !== null && diasParado > SLA_PADRAO_DIAS;
                return (
                  <tr key={p.id} className={(sel?'row-selected ':'')+(estourouSla?'row-atrasada':'')} onClick={isAdmin?()=>toggleSelecionado(p.id):undefined} style={isAdmin?{cursor:'pointer'}:{}}>
                    {isAdmin && <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}><input type="checkbox" className="cb" checked={sel} onChange={()=>toggleSelecionado(p.id)}/></td>}
                    <td className="id-cell" onClick={e=>e.stopPropagation()}>
                      {p.id}
                      {p.origem==='erp'&&<span className="tag-erp">ERP</span>}
                      {p.confianca&&p.confianca!=='alta'&&<span className={'tag-conf '+p.confianca}>{p.confianca}</span>}
                    </td>
                    <td><div className="ellipsis" title={p.loja} style={{maxWidth:110,fontSize:10,color:'var(--muted)'}}>{p.loja||'—'}</div></td>
                    <td><div className="pagador-cell ellipsis" title={p.pagador}>{p.pagador||'—'}</div></td>
                    <td><div className="emp-cell ellipsis" title={p.empreendimento}>{p.empreendimento||'—'}</div></td>
                    <td className="prop-cell">{p.proposta||'—'}</td>
                    <td className="date-cell">{p.dataReceb||'—'}</td>
                    <td className="val-cell">{fmt(p.valor)}</td>
                    <td><span className={'badge '+b.cls}>{b.label}</span></td>
                    <td style={{fontSize:11}}>{p.responsavel||<span style={{color:'var(--muted)',fontStyle:'italic'}}>a definir</span>}</td>
                    <td style={{fontSize:11,color:'var(--text2)'}}><div className="ellipsis" style={{maxWidth:140}} title={p.acao}>{p.acao||'—'}</div></td>
                    <td style={{whiteSpace:'nowrap',display:'flex',gap:3,paddingTop:8}} onClick={e=>e.stopPropagation()}>
                      <button className="row-btn" onClick={()=>openModal(p.id)}>editar</button>
                      {isAdmin && <button className="row-btn del" onClick={()=>deletar(p.id)}>excluir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      <div className={'overlay'+(modalOpen?' open':'')}>
        <div className="modal">
          <div className="modal-head">
            <div>
              <div className="modal-eyebrow">CSC Financeiro · Contas a Receber</div>
              <div className="modal-head-title">{editingId?`Editar Pendência — ${editingId}`:'Nova Pendência'}</div>
            </div>
            <button className="modal-close" onClick={closeModal}>✕</button>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="fg"><label>C.Custo / Loja</label><input type="text" placeholder="Ex: RECEITA COMERCIAL LANÇAMENTO" value={form.loja||''} onChange={e=>setForm(f=>({...f,loja:e.target.value}))}/></div>
              <div className="fg"><label>Status</label><select value={form.status||'Pendente'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Pendente</option><option>Em andamento</option><option>Atrasada</option><option>Resolvida</option></select></div>
              <div className="fg"><label>Pagador</label><input type="text" placeholder="Nome completo do pagador" value={form.pagador||''} onChange={e=>setForm(f=>({...f,pagador:e.target.value}))}/></div>
              <div className="fg"><label>Empreendimento</label><input type="text" placeholder="Ex: Lottus Residence..." value={form.empreendimento||''} onChange={e=>setForm(f=>({...f,empreendimento:e.target.value}))}/></div>
              <div className="fg"><label>Proposta / Contrato</label><input type="text" placeholder="Nº da proposta" value={form.proposta||''} onChange={e=>setForm(f=>({...f,proposta:e.target.value}))}/></div>
              <div className="fg"><label>Data Receb.</label><input type="text" placeholder="DD/MM/AAAA" value={form.dataReceb||''} onChange={e=>setForm(f=>({...f,dataReceb:e.target.value}))}/></div>
              <div className="fg"><label>Valor (R$)</label><input type="number" placeholder="0,00" min="0" step="0.01" value={form.valor??''} onChange={e=>setForm(f=>({...f,valor:e.target.value}))}/></div>
              <div className="fg"><label>Tipo</label><select value={form.tipo||'Documentação'} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}><option>Documentação</option><option>Pagamento</option><option>Assinatura</option><option>Vistoria</option><option>Outro</option></select></div>
              <div className="fg"><label>Responsável Atual</label><input type="text" placeholder="Nome do responsável" value={form.responsavel||''} onChange={e=>setForm(f=>({...f,responsavel:e.target.value}))}/></div>
              <div className="fg full"><label>Próxima Ação</label><input type="text" placeholder="Descreva a próxima ação" value={form.acao||''} onChange={e=>setForm(f=>({...f,acao:e.target.value}))}/></div>
              <div className="fg full"><label>Observações</label><textarea placeholder="Informações relevantes, tratativas, contatos..." value={form.obs||''} onChange={e=>setForm(f=>({...f,obs:e.target.value}))}/></div>
              {editingId && (() => {
                const pAtual = pendencias.find(x=>x.id===editingId);
                const diasParado = pAtual && pAtual.status!=='Resolvida' ? diasDesdeUltimaMovimentacao(pAtual) : null;
                const estourou = diasParado !== null && diasParado > SLA_PADRAO_DIAS;
                return (
                  <>
                    {diasParado !== null && (
                      <div className="fg full">
                        <div className={'sla-modal-box'+(estourou?' sla-estourado':'')}>
                          <div className="sla-modal-label">SLA de resposta</div>
                          <div className="sla-modal-valor">
                            {diasParado === 0 && 'Movimentado hoje — dentro do prazo'}
                            {diasParado === 1 && !estourou && '1 dia sem nova movimentação — dentro do prazo'}
                            {diasParado > 1 && !estourou && `${diasParado} dias sem nova movimentação — dentro do prazo`}
                            {estourou && `⚠ ${diasParado} dia${diasParado>1?'s':''} sem retorno — SLA estourado (prazo: ${SLA_PADRAO_DIAS} dia${SLA_PADRAO_DIAS>1?'s':''})`}
                          </div>
                          <div className="sla-modal-hint">Prazo padrão para retorno: {SLA_PADRAO_DIAS} dia útil · Adicione uma tratativa no histórico para reiniciar o contador</div>
                        </div>
                      </div>
                    )}
                    <div className="section-divider">Histórico de tratativas</div>
                    <div className="fg full">
                      <ul className="hist-list">{(form.historico||[]).map((h,i)=><li className="hist-item" key={i}>{h}</li>)}</ul>
                      <input className="hist-input" type="text" placeholder="Adicionar registro ao histórico..." value={histNew} onChange={e=>setHistNew(e.target.value)}/>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-outline" onClick={closeModal}>Cancelar</button>
            <button className="btn btn-primary" onClick={savePendencia} disabled={saving}>{saving?'Salvando...':'Salvar Pendência'}</button>
          </div>
        </div>
      </div>

      {/* TOAST */}
      <div className={'toast'+(toast?' show':'')}><div className="toast-icon"/><span>{toast}</span></div>

      {/* FOOTER */}
      <div className="footer-bar">
        <div className="footer-info">My Broker Imóveis · CSC Financeiro · Central de Pendências</div>
        <div className="footer-actions">
          {isAdmin && <button className="footer-btn" onClick={()=>setImportOpen(v=>!v)}>↓ importar erp</button>}
          <button className="footer-btn" onClick={()=>router.push('/dashboard')}>📊 dashboard</button>
          <button className="footer-btn" onClick={exportExcel}>↑ exportar xlsx</button>
          {isAdmin && <button className="footer-btn" onClick={()=>openModal(null)}>+ nova pendência</button>}
          <button className="footer-btn" onClick={handleLogout}>⏻ sair</button>
        </div>
      </div>

      <style>{`
        .user-pill{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.08);padding:4px 10px 4px 12px;border:1px solid rgba(255,255,255,.15);}
        .user-nome{font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;color:rgba(255,255,255,.85);}
        .user-role{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;padding:2px 6px;}
        .role-admin{background:rgba(255,202,3,.2);color:#FFCA03;}
        .role-editor{background:rgba(255,255,255,.1);color:rgba(255,255,255,.5);}
        .user-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);width:26px;height:26px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s;}
        .user-btn:hover{background:rgba(255,255,255,.18);color:#fff;}
        .cb{width:15px;height:15px;cursor:pointer;accent-color:var(--blue);}
        tr.row-selected td{background:rgba(30,67,249,.06)!important;}
        tr.row-selected:hover td{background:rgba(30,67,249,.1)!important;}
        .bulk-bar{background:var(--navy);border-top:3px solid var(--blue);border-bottom:1px solid rgba(255,255,255,.08);padding:10px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;animation:slideDown .2s ease;}
        @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        .bulk-info{display:flex;align-items:center;gap:10px;}
        .bulk-count{font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--yellow);line-height:1;}
        .bulk-info span{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.6);}
        .chip-danger{background:var(--danger)!important;color:#fff!important;border-color:var(--danger)!important;}
        .chip-danger:hover{background:#c0102a!important;}
        .chip-danger:disabled{opacity:.6;cursor:not-allowed;}

        /* ── SLA de resposta / Atraso automático ── */
        .metric.sla{border-color:#8A96B0;}
        .sla-hint{background:var(--navy);padding:0 24px 14px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1.5px;color:rgba(255,255,255,.3);}

        tr.row-atrasada td{background:rgba(232,51,74,.04);}
        tr.row-atrasada:hover td{background:rgba(232,51,74,.08)!important;}
        tr.row-atrasada .id-cell{border-left:3px solid var(--danger);padding-left:8px;}

        .sla-tag{display:inline-block;margin-left:6px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:1px 5px;color:var(--muted);background:rgba(138,150,176,.12);}
        .sla-tag.estourado{background:rgba(232,51,74,.15);color:var(--danger);font-weight:700;}

        /* SLA box dentro do modal */
        .sla-modal-box{padding:10px 14px;background:var(--off);border-left:3px solid var(--blue);margin-top:2px;}
        .sla-modal-box.sla-estourado{background:#FEF2F2;border-left-color:var(--danger);}
        .sla-modal-label{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;}
        .sla-modal-valor{font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;}
        .sla-modal-box.sla-estourado .sla-modal-valor{color:var(--danger);}
        .sla-modal-hint{font-size:11px;color:var(--muted);}

        /* ── Cards de status clicáveis (filtro rápido) ── */
        .metric.clickable{cursor:pointer; transition:transform .12s, background .15s;}
        .metric.clickable:hover{background:rgba(255,255,255,.09);}
        .metric.clickable:active{transform:scale(.97);}
        .metric.active{outline:2px solid var(--yellow); outline-offset:-2px;}
      `}</style>
    </>
  );
}
