import { useEffect, useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

function parseCamposERP(raw) {
  const s = String(raw || '').trim();
  const result = { pagador: '', proposta: '', empreendimento: '', unidade: '', statusVenda: '', confianca: 'baixa' };
  if (!s) return result;
  let limpo = s.replace(/^Recebimentos\s*\[[^\]]*\]\s*-?\s*/i, '').trim();
  limpo = limpo.replace(/`/g, '').trim();
  if (!limpo) return result;
  let statusVenda = '';
  const vm = limpo.match(/VENDA\s+NA\s+ABA[:\-]?\s*(.+)$/i);
  if (vm) { statusVenda = 'Venda na aba: ' + vm[1].trim(); limpo = limpo.slice(0, vm.index).trim(); }
  const pm = limpo.match(/\(([^)]+)\)\s*$/);
  if (pm) { statusVenda = (statusVenda ? statusVenda + ' · ' : '') + pm[1].trim(); limpo = limpo.slice(0, pm.index).trim(); }
  result.statusVenda = statusVenda;
  limpo = limpo.replace(/[-\/]\s*$/, '').trim();
  if (!limpo) return result;
  let unidade = '';
  const um = limpo.match(/^(.*?)\s*-?\s*(Unidade\s+.*?(?:Bl\/?Qd\s*[\w\-]*)?)\s*$/i);
  if (um && um[2]) { unidade = um[2].trim(); limpo = um[1].trim(); }
  result.unidade = unidade;
  limpo = limpo.replace(/[-\/]\s*$/, '').trim();
  let mProp = limpo.match(/^proposta\s*[:\-]?\s*(\d+)\s*$/i);
  if (mProp) { result.proposta = mProp[1]; result.confianca = 'alta'; return result; }
  let blocos = limpo.split(/\s+-\s+/).map((b) => b.trim()).filter(Boolean);
  if (!blocos.length) return result;
  function extraiProposta(bloco) {
    let m = bloco.match(/^(.*?)[\/]\s*(\d{5,})\s*$/);
    if (m) return { nome: m[1].trim(), prop: m[2] };
    m = bloco.match(/^(.*?)\s+(\d{5,})\s*$/);
    if (m) return { nome: m[1].trim(), prop: m[2] };
    m = bloco.match(/^(\d{5,})\s*$/);
    if (m) return { nome: '', prop: m[1] };
    m = bloco.match(/^proposta\s*[:\-]?\s*(\d+)\s*(.*)$/i);
    if (m) return { nome: m[2] ? m[2].trim() : '', prop: m[1] };
    return null;
  }
  const b0 = blocos[0];
  const ep0 = extraiProposta(b0);
  if (ep0 && ep0.nome) { result.pagador = ep0.nome; result.proposta = ep0.prop; result.confianca = 'alta'; }
  else if (ep0 && !ep0.nome) { result.proposta = ep0.prop; result.confianca = 'media'; }
  else if (/^proposta$/i.test(b0)) { result.confianca = 'baixa'; }
  else { result.pagador = b0; result.confianca = 'media'; }
  for (let i = 1; i < blocos.length; i++) {
    const b = blocos[i];
    const epi = extraiProposta(b);
    if (epi) { if (epi.prop && !result.proposta) result.proposta = epi.prop; if (epi.nome && !result.empreendimento) result.empreendimento = epi.nome; continue; }
    if (/^proposta$/i.test(b)) continue;
    if (!result.empreendimento) result.empreendimento = b; else result.empreendimento += ' · ' + b;
  }
  if (!result.pagador && !result.empreendimento && !result.proposta) { result.pagador = blocos.join(' - '); result.confianca = 'baixa'; }
  return result;
}

function extrairObsERP(raw) {
  const r = parseCamposERP(raw);
  const partes = [];
  if (r.unidade) partes.push(r.unidade);
  if (r.statusVenda) partes.push(r.statusVenda);
  return partes.join(' · ');
}

const CAMPOS_DESTINO = [
  { key: 'ccusto', label: 'C.Custo / Loja' },
  { key: 'contrato', label: 'Contrato (texto rico — será separado automaticamente)' },
  { key: 'descricao', label: 'Descrição (obs)' },
  { key: 'pagador', label: 'Pagador (já separado)' },
  { key: 'empreendimento', label: 'Empreendimento (já separado)' },
  { key: 'proposta', label: 'Proposta (já separado)' },
  { key: 'data', label: 'Data Receb.' },
  { key: 'valor', label: 'Valor' },
  { key: 'ignorar', label: '— Ignorar —' },
];

const HEURISTICS = {
  ccusto: ['c.custo', 'ccusto', 'centro', 'custo', 'loja', 'setor', 'cc'],
  contrato: ['contrato'],
  descricao: ['descri', 'desc'],
  pagador: ['pagador'],
  empreendimento: ['empreend', 'empreendimento', 'imovel', 'produto'],
  proposta: ['proposta', 'venda', 'numdoc', 'documento'],
  data: ['data', 'date', 'receb', 'venc'],
  valor: ['valor', 'value', 'total', 'vlr', 'vl'],
};

function guessField(col) {
  const lc = col.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (lc === 'cliente') return 'ignorar';
  for (const [k, kws] of Object.entries(HEURISTICS)) {
    if (kws.some((kw) => lc.includes(kw))) return k;
  }
  return 'ignorar';
}

function parseValor(raw) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).replace(/[^\d,\.]/g, '');
  const n = s.includes(',') && s.includes('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  return parseFloat(n) || 0;
}

function parseData(raw) {
  if (!raw) return '';
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return String(d.d).padStart(2, '0') + '/' + String(d.m).padStart(2, '0') + '/' + d.y;
  }
  return String(raw);
}

function fmt(v) {
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function badge(s) {
  const m = { Pendente: 'bp', 'Em andamento': 'ba', Atrasada: 'bat', Resolvida: 'br' };
  return { cls: m[s] || 'bp', label: s };
}

function nextId(existing) {
  let max = 0;
  existing.forEach((p) => {
    const m = String(p.id).match(/PND-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'PND-' + String(max + 1).padStart(3, '0');
}

export default function Home() {
  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fTipo, setFTipo] = useState('');

  // ── Seleção múltipla ──
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
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);

  const loadPendencias = useCallback(async () => {
    setLoading(true);
    setErro('');
    const { data, error } = await supabase.from('pendencias').select('*').order('created_at', { ascending: true });
    if (error) { setErro('Erro ao carregar dados: ' + error.message); setLoading(false); return; }
    const mapped = (data || []).map((row) => ({
      id: row.id, loja: row.loja || '', pagador: row.pagador || '',
      empreendimento: row.empreendimento || '', proposta: row.proposta || '',
      dataReceb: row.data_receb || '', valor: Number(row.valor) || 0,
      tipo: row.tipo || 'Documentação', status: row.status || 'Pendente',
      responsavel: row.responsavel || '', acao: row.acao || '', obs: row.obs || '',
      historico: Array.isArray(row.historico) ? row.historico : [],
      origem: row.origem || 'manual', confianca: row.confianca || null,
    }));
    setPendencias(mapped);
    setSelecionados(new Set()); // limpa seleção ao recarregar
    setLoading(false);
  }, []);

  useEffect(() => { loadPendencias(); }, [loadPendencias]);

  const filtered = pendencias.filter((p) => {
    const b = busca.toLowerCase();
    const bOk = !b || [p.pagador, p.empreendimento, p.proposta, p.loja, p.id].some((x) => (x || '').toLowerCase().includes(b));
    return bOk && (!fStatus || p.status === fStatus) && (!fTipo || p.tipo === fTipo);
  });

  const metrics = {
    total: pendencias.length,
    pend: pendencias.filter((p) => p.status === 'Pendente').length,
    and: pendencias.filter((p) => p.status === 'Em andamento').length,
    atr: pendencias.filter((p) => p.status === 'Atrasada').length,
    res: pendencias.filter((p) => p.status === 'Resolvida').length,
    val: pendencias.reduce((a, p) => a + Number(p.valor), 0),
  };

  // ── Helpers de seleção ──
  const todosVisivelsSelecionados = filtered.length > 0 && filtered.every((p) => selecionados.has(p.id));
  const algumSelecionado = selecionados.size > 0;

  function toggleSelecionado(id) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    if (todosVisivelsSelecionados) {
      // desmarca todos os visíveis
      setSelecionados((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      // marca todos os visíveis
      setSelecionados((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  async function deletarSelecionados() {
    const ids = Array.from(selecionados);
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} pendência(s) selecionada(s)? Esta ação não pode ser desfeita.`)) return;
    setDeletandoLote(true);
    const { error } = await supabase.from('pendencias').delete().in('id', ids);
    setDeletandoLote(false);
    if (error) { showToast('Erro ao excluir: ' + error.message); return; }
    await loadPendencias();
    showToast(`${ids.length} pendência(s) excluída(s) com sucesso.`);
  }

  async function deletar(id) {
    if (!confirm('Excluir a pendência ' + id + '? Esta ação não pode ser desfeita.')) return;
    const { error } = await supabase.from('pendencias').delete().eq('id', id);
    if (error) { showToast('Erro ao excluir: ' + error.message); return; }
    await loadPendencias();
    showToast('Pendência removida.');
  }

  // ── Importação ──
  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!json || json.length < 2) { alert('Arquivo vazio ou sem dados.'); return; }
      const cols = json[0].map(String);
      const rows = json.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      setDetectedCols(cols); setImportedRows(rows); setPreviewRows(json.slice(1, 6));
      const initialMap = {};
      cols.forEach((col, i) => { initialMap[i] = guessField(col); });
      setMapping(initialMap);
    };
    reader.readAsArrayBuffer(file);
  }

  function getMappingByField() {
    const m = {};
    Object.entries(mapping).forEach(([idx, field]) => { if (field !== 'ignorar') m[field] = parseInt(idx, 10); });
    return m;
  }

  async function doImport() {
    const map = getMappingByField();
    setSaving(true);
    const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const novas = [];
    let seedExisting = [...pendencias];
    importedRows.forEach((row) => {
      const cRaw = map.contrato !== undefined ? String(row[map.contrato] || '') : '';
      const descRaw = map.descricao !== undefined ? String(row[map.descricao] || '') : '';
      const parsed = parseCamposERP(cRaw);
      const obsAuto = extrairObsERP(cRaw);
      const obsPartes = [];
      if (descRaw) obsPartes.push(descRaw);
      if (obsAuto) obsPartes.push(obsAuto);
      if (cRaw) obsPartes.push('Texto original ERP: ' + cRaw);
      const newId = nextId(seedExisting);
      const nova = {
        id: newId,
        loja: map.ccusto !== undefined ? String(row[map.ccusto] || '') : '',
        pagador: map.pagador !== undefined ? String(row[map.pagador] || '') : parsed.pagador,
        empreendimento: map.empreendimento !== undefined ? String(row[map.empreendimento] || '') : parsed.empreendimento,
        proposta: map.proposta !== undefined ? String(row[map.proposta] || '') : parsed.proposta,
        dataReceb: map.data !== undefined ? parseData(row[map.data]) : '',
        valor: map.valor !== undefined ? parseValor(row[map.valor]) : 0,
        tipo: 'Documentação', status: 'Pendente', responsavel: '', acao: 'A definir',
        obs: obsPartes.join(' · '),
        historico: [dateStr + ' - Importado do ERP automaticamente (confiança: ' + parsed.confianca + ')'],
        origem: 'erp', confianca: parsed.confianca,
      };
      novas.push(nova);
      seedExisting = [...seedExisting, nova];
    });
    const payload = novas.map((p) => ({
      id: p.id, loja: p.loja, pagador: p.pagador, empreendimento: p.empreendimento,
      proposta: p.proposta, data_receb: p.dataReceb, valor: p.valor, tipo: p.tipo,
      status: p.status, responsavel: p.responsavel, acao: p.acao, obs: p.obs,
      historico: p.historico, origem: p.origem, confianca: p.confianca,
    }));
    const { error } = await supabase.from('pendencias').insert(payload);
    setSaving(false);
    if (error) { showToast('Erro ao importar: ' + error.message); return; }
    await loadPendencias();
    setImportOpen(false); setDetectedCols([]); setImportedRows([]); setPreviewRows([]); setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    const baixaMedia = novas.filter((p) => p.confianca === 'media' || p.confianca === 'baixa').length;
    showToast(novas.length + ' pendência(s) importada(s)! ' + (baixaMedia ? baixaMedia + ' precisam de revisão manual.' : 'Tudo extraído com alta confiança.'));
  }

  // ── Modal ──
  function openModal(id) {
    setEditingId(id);
    if (id) { const p = pendencias.find((x) => x.id === id); setForm({ ...p }); }
    else { setForm({ loja: '', status: 'Pendente', pagador: '', empreendimento: '', proposta: '', dataReceb: '', valor: '', tipo: 'Documentação', responsavel: '', acao: '', obs: '', historico: [] }); }
    setHistNew(''); setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditingId(null); }

  async function savePendencia() {
    setSaving(true);
    const resp = (form.responsavel || '').trim() || 'Sistema';
    const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (editingId) {
      const existing = pendencias.find((p) => p.id === editingId);
      const novoHistorico = [...(existing.historico || [])];
      novoHistorico.push(histNew ? `${dateStr} - ${histNew} (${resp})` : `${dateStr} - Atualizado (${resp})`);
      const payload = { loja: form.loja || '', pagador: form.pagador || '', empreendimento: form.empreendimento || '', proposta: form.proposta || '', data_receb: form.dataReceb || '', valor: parseFloat(form.valor) || 0, tipo: form.tipo || 'Documentação', status: form.status || 'Pendente', responsavel: resp, acao: form.acao || '', obs: form.obs || '', historico: novoHistorico };
      const { error } = await supabase.from('pendencias').update(payload).eq('id', editingId);
      setSaving(false);
      if (error) { showToast('Erro ao salvar: ' + error.message); return; }
    } else {
      const newId = nextId(pendencias);
      const payload = { id: newId, loja: form.loja || '', pagador: form.pagador || '', empreendimento: form.empreendimento || '', proposta: form.proposta || '', data_receb: form.dataReceb || '', valor: parseFloat(form.valor) || 0, tipo: form.tipo || 'Documentação', status: form.status || 'Pendente', responsavel: resp, acao: form.acao || '', obs: form.obs || '', historico: [`${dateStr} - Criado por ${resp}`], origem: 'manual' };
      const { error } = await supabase.from('pendencias').insert(payload);
      setSaving(false);
      if (error) { showToast('Erro ao criar: ' + error.message); return; }
    }
    await loadPendencias(); closeModal(); showToast('Pendência salva com sucesso!');
  }

  function exportExcel() {
    if (!pendencias.length) { alert('Nenhuma pendência para exportar.'); return; }
    const rows = pendencias.map((p) => ({ ID: p.id, Origem: p.origem === 'erp' ? 'ERP' : 'Manual', 'C.Custo / Loja': p.loja, Pagador: p.pagador, Empreendimento: p.empreendimento, 'Proposta / Contrato': p.proposta, 'Data Receb.': p.dataReceb, 'Valor (R$)': p.valor, Tipo: p.tipo, Status: p.status, Responsável: p.responsavel, 'Próxima Ação': p.acao, Observações: p.obs, Histórico: (p.historico || []).join(' | ') }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 30 }, { wch: 26 }, { wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 32 }, { wch: 42 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pendências');
    XLSX.writeFile(wb, 'Central_Pendencias_MyBroker_' + new Date().toLocaleDateString('pt-BR').replace(/\//g, '-') + '.xlsx');
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
          <button className="chip" onClick={() => setImportOpen((v) => !v)}>↓ Importar ERP</button>
          <button className="chip" onClick={exportExcel}>↑ Exportar Excel</button>
          <button className="chip chip-yellow" onClick={() => openModal(null)}>+ Nova Pendência</button>
        </div>
      </div>

      {erro && <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '10px 24px', fontSize: 12 }}>{erro}</div>}

      {/* IMPORT PANEL */}
      <div className={'import-panel' + (importOpen ? ' open' : '')}>
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
              <div className="drop-hint">.xlsx · .xls · .csv exportado do ERP</div>
            </div>
            {fileName && <div className="file-ok" style={{ display: 'block' }}>✓ {fileName}</div>}
          </div>
          <div className="import-card">
            <div className="import-card-num">02</div>
            <div className="import-card-label">Mapeamento de colunas</div>
            {detectedCols.length === 0 ? (
              <div className="map-empty">Carregue um arquivo para configurar o mapeamento</div>
            ) : (
              detectedCols.map((col, i) => (
                <div className="map-row" key={i}>
                  <div className="map-lbl" title={col}>{col}</div>
                  <div className="map-arr">→</div>
                  <select className="map-sel" value={mapping[i] || 'ignorar'} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}>
                    {CAMPOS_DESTINO.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))
            )}
          </div>
        </div>
        {previewRows.length > 0 && (
          <div className="preview-wrap" style={{ display: 'block' }}>
            <div className="preview-eyebrow">Pré-visualização — primeiras 5 linhas</div>
            <div className="preview-scroll">
              <table className="ptbl">
                <thead><tr>{detectedCols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                <tbody>{previewRows.map((r, ri) => <tr key={ri}>{detectedCols.map((_, ci) => <td key={ci}>{String(r[ci] || '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
        <div className="import-footer">
          <div className="import-info">{importedRows.length > 0 ? `${importedRows.length} linha(s) encontrada(s) · ${detectedCols.length} coluna(s)` : ''}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="chip" onClick={() => setImportOpen(false)}>Cancelar</button>
            {importedRows.length > 0 && <button className="chip chip-yellow" onClick={doImport} disabled={saving}>{saving ? 'Importando...' : '✓ Importar pendências'}</button>}
          </div>
        </div>
      </div>

      {/* METRICS */}
      <div className="metrics-section">
        <div className="metrics-eyebrow">Visão geral · atualizado agora</div>
        <div className="metrics">
          <div className="metric total"><div className="metric-num">∑</div><div className="metric-lbl">Total</div><div className="metric-val">{metrics.total}</div></div>
          <div className="metric pend"><div className="metric-num">P</div><div className="metric-lbl">Pendentes</div><div className="metric-val yellow">{metrics.pend}</div></div>
          <div className="metric and"><div className="metric-num">A</div><div className="metric-lbl">Em andamento</div><div className="metric-val">{metrics.and}</div></div>
          <div className="metric atr"><div className="metric-num">!</div><div className="metric-lbl">Atrasadas</div><div className="metric-val danger">{metrics.atr}</div></div>
          <div className="metric res"><div className="metric-num">✓</div><div className="metric-lbl">Resolvidas</div><div className="metric-val green">{metrics.res}</div></div>
          <div className="metric val"><div className="metric-num">R$</div><div className="metric-lbl">Valor Total</div><div className="metric-val sm">{fmt(metrics.val)}</div></div>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="toolbar">
        <input className="fld" type="text" placeholder="Buscar pagador, empreendimento, proposta, ID..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="fld" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option>Pendente</option><option>Em andamento</option><option>Atrasada</option><option>Resolvida</option>
        </select>
        <select className="fld" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option>Documentação</option><option>Pagamento</option><option>Assinatura</option><option>Vistoria</option><option>Outro</option>
        </select>
        {loading && <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 11, fontFamily: "'DM Mono',monospace" }}>carregando…</span>}
      </div>

      {/* BARRA DE AÇÕES EM LOTE — aparece só quando há seleção */}
      {algumSelecionado && (
        <div className="bulk-bar">
          <div className="bulk-info">
            <div className="bulk-count">{selecionados.size}</div>
            <span>pendência{selecionados.size > 1 ? 's' : ''} selecionada{selecionados.size > 1 ? 's' : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="chip" onClick={() => setSelecionados(new Set())}>Cancelar seleção</button>
            <button className="chip chip-danger" onClick={deletarSelecionados} disabled={deletandoLote}>
              {deletandoLote ? 'Excluindo...' : `🗑 Excluir ${selecionados.size} selecionada${selecionados.size > 1 ? 's' : ''}`}
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
                <th style={{ width: 40, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    className="cb"
                    checked={todosVisivelsSelecionados}
                    onChange={toggleTodos}
                    title={todosVisivelsSelecionados ? 'Desmarcar todos' : 'Selecionar todos visíveis'}
                  />
                </th>
                <th>ID</th><th>C.Custo / Loja</th><th>Pagador</th><th>Empreendimento</th>
                <th>Proposta</th><th>Data Receb.</th><th>Valor</th>
                <th>Status</th><th>Responsável</th><th>Próxima Ação</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={12}>
                    {loading ? 'Carregando pendências...' : pendencias.length === 0
                      ? 'Nenhuma pendência cadastrada — importe via ERP ou crie manualmente'
                      : 'Nenhum resultado para os filtros selecionados'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const b = badge(p.status);
                  const selecionado = selecionados.has(p.id);
                  return (
                    <tr key={p.id} className={selecionado ? 'row-selected' : ''} onClick={() => toggleSelecionado(p.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="cb" checked={selecionado} onChange={() => toggleSelecionado(p.id)} />
                      </td>
                      <td className="id-cell" onClick={(e) => e.stopPropagation()}>
                        {p.id}
                        {p.origem === 'erp' && <span className="tag-erp">ERP</span>}
                        {p.confianca && p.confianca !== 'alta' && <span className={'tag-conf ' + p.confianca}>{p.confianca}</span>}
                      </td>
                      <td><div className="ellipsis" title={p.loja} style={{ maxWidth: 110, fontSize: 10, color: 'var(--muted)' }}>{p.loja || '—'}</div></td>
                      <td><div className="pagador-cell ellipsis" title={p.pagador}>{p.pagador || '—'}</div></td>
                      <td><div className="emp-cell ellipsis" title={p.empreendimento}>{p.empreendimento || '—'}</div></td>
                      <td className="prop-cell">{p.proposta || '—'}</td>
                      <td className="date-cell">{p.dataReceb || '—'}</td>
                      <td className="val-cell">{fmt(p.valor)}</td>
                      <td><span className={'badge ' + b.cls}>{b.label}</span></td>
                      <td style={{ fontSize: 11 }}>{p.responsavel || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>a definir</span>}</td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}><div className="ellipsis" style={{ maxWidth: 140 }} title={p.acao}>{p.acao || '—'}</div></td>
                      <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 3, paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                        <button className="row-btn" onClick={() => openModal(p.id)}>editar</button>
                        <button className="row-btn del" onClick={() => deletar(p.id)}>excluir</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      <div className={'overlay' + (modalOpen ? ' open' : '')}>
        <div className="modal">
          <div className="modal-head">
            <div>
              <div className="modal-eyebrow">CSC Financeiro · Contas a Receber</div>
              <div className="modal-head-title">{editingId ? `Editar Pendência — ${editingId}` : 'Nova Pendência'}</div>
            </div>
            <button className="modal-close" onClick={closeModal}>✕</button>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="fg"><label>C.Custo / Loja</label><input type="text" placeholder="Ex: RECEITA COMERCIAL LANÇAMENTO" value={form.loja || ''} onChange={(e) => setForm((f) => ({ ...f, loja: e.target.value }))} /></div>
              <div className="fg"><label>Status</label><select value={form.status || 'Pendente'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>Pendente</option><option>Em andamento</option><option>Atrasada</option><option>Resolvida</option></select></div>
              <div className="fg"><label>Pagador</label><input type="text" placeholder="Nome completo do pagador" value={form.pagador || ''} onChange={(e) => setForm((f) => ({ ...f, pagador: e.target.value }))} /></div>
              <div className="fg"><label>Empreendimento</label><input type="text" placeholder="Ex: Lottus Residence..." value={form.empreendimento || ''} onChange={(e) => setForm((f) => ({ ...f, empreendimento: e.target.value }))} /></div>
              <div className="fg"><label>Proposta / Contrato</label><input type="text" placeholder="Nº da proposta ou contrato" value={form.proposta || ''} onChange={(e) => setForm((f) => ({ ...f, proposta: e.target.value }))} /></div>
              <div className="fg"><label>Data Receb.</label><input type="text" placeholder="DD/MM/AAAA" value={form.dataReceb || ''} onChange={(e) => setForm((f) => ({ ...f, dataReceb: e.target.value }))} /></div>
              <div className="fg"><label>Valor (R$)</label><input type="number" placeholder="0,00" min="0" step="0.01" value={form.valor ?? ''} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} /></div>
              <div className="fg"><label>Tipo</label><select value={form.tipo || 'Documentação'} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}><option>Documentação</option><option>Pagamento</option><option>Assinatura</option><option>Vistoria</option><option>Outro</option></select></div>
              <div className="fg"><label>Responsável Atual</label><input type="text" placeholder="Nome do responsável" value={form.responsavel || ''} onChange={(e) => setForm((f) => ({ ...f, responsavel: e.target.value }))} /></div>
              <div className="fg full"><label>Próxima Ação</label><input type="text" placeholder="Descreva a próxima ação prevista" value={form.acao || ''} onChange={(e) => setForm((f) => ({ ...f, acao: e.target.value }))} /></div>
              <div className="fg full"><label>Observações</label><textarea placeholder="Digite aqui informações relevantes..." value={form.obs || ''} onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))} /></div>
              {editingId && (
                <>
                  <div className="section-divider">Histórico de tratativas</div>
                  <div className="fg full">
                    <ul className="hist-list">{(form.historico || []).map((h, i) => <li className="hist-item" key={i}>{h}</li>)}</ul>
                    <input className="hist-input" type="text" placeholder="Adicionar novo registro ao histórico..." value={histNew} onChange={(e) => setHistNew(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-outline" onClick={closeModal}>Cancelar</button>
            <button className="btn btn-primary" onClick={savePendencia} disabled={saving}>{saving ? 'Salvando...' : 'Salvar Pendência'}</button>
          </div>
        </div>
      </div>

      {/* TOAST */}
      <div className={'toast' + (toast ? ' show' : '')}><div className="toast-icon" /><span>{toast}</span></div>

      {/* FOOTER */}
      <div className="footer-bar">
        <div className="footer-info">My Broker Imóveis · CSC Financeiro · Central de Pendências</div>
        <div className="footer-actions">
          <button className="footer-btn" onClick={() => setImportOpen((v) => !v)}>↓ importar erp</button>
          <button className="footer-btn" onClick={exportExcel}>↑ exportar xlsx</button>
          <button className="footer-btn" onClick={() => openModal(null)}>+ nova pendência</button>
        </div>
      </div>

      <style>{`
        /* ── Checkbox customizado ── */
        .cb { width: 15px; height: 15px; cursor: pointer; accent-color: var(--blue); }

        /* ── Linha selecionada ── */
        tr.row-selected td { background: rgba(30,67,249,.06) !important; }
        tr.row-selected:hover td { background: rgba(30,67,249,.1) !important; }

        /* ── Barra de ações em lote ── */
        .bulk-bar {
          background: var(--navy);
          border-top: 3px solid var(--blue);
          border-bottom: 1px solid rgba(255,255,255,.08);
          padding: 10px 24px;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          animation: slideDown .2s ease;
        }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .bulk-info { display: flex; align-items: center; gap: 10px; }
        .bulk-count {
          font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: var(--yellow); line-height: 1;
        }
        .bulk-info span { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,.6); }
        .chip-danger { background: var(--danger) !important; color: #fff !important; border-color: var(--danger) !important; }
        .chip-danger:hover { background: #c0102a !important; }
        .chip-danger:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </>
  );
}
