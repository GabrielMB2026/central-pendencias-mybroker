import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// ── Utilitários ──
function parseDataCurta(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const ano = new Date().getFullYear();
  const dt = new Date(ano, parseInt(m[2],10)-1, parseInt(m[1],10));
  return isNaN(dt.getTime()) ? null : dt;
}
function dataCriacaoDoHistorico(historico) {
  if (!historico?.length) return null;
  return parseDataCurta(historico[0]);
}
function dataResolucaoDoHistorico(historico) {
  if (!historico?.length) return null;
  for (let i = historico.length-1; i>=0; i--) {
    if (/resolvid/i.test(String(historico[i]))) return parseDataCurta(historico[i]);
  }
  return null;
}
function dataUltimaMovimentacao(historico) {
  if (!historico?.length) return null;
  return parseDataCurta(historico[historico.length-1]);
}
const SLA_PADRAO_DIAS = 1;
function diasDesdeUltimaMovimentacao(p) {
  const dt = dataUltimaMovimentacao(p.historico) || dataCriacaoDoHistorico(p.historico);
  if (!dt) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0); dt.setHours(0,0,0,0);
  return Math.round((hoje - dt) / 86400000);
}
function statusEfetivo(p) {
  if (p.status === 'Resolvida') return 'Resolvida';
  const dias = diasDesdeUltimaMovimentacao(p);
  if (dias !== null && dias > SLA_PADRAO_DIAS) return 'Atrasada';
  return p.status;
}
function fmt(v) {
  return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtN(v) {
  return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:1});
}
function mesAno(dt) {
  if (!dt) return null;
  return String(dt.getMonth()+1).padStart(2,'0')+'/'+dt.getFullYear();
}

// ── Componente barra horizontal simples ──
function BarraH({ label, valor, total, cor, sub }) {
  const pct = total > 0 ? Math.round((valor/total)*100) : 0;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
        <span style={{fontSize:12,fontWeight:500,color:'var(--db-text)'}}>{label}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:'var(--db-text2)'}}>{valor} <span style={{color:'var(--db-muted)'}}>{sub||('('+pct+'%)')}</span></span>
      </div>
      <div style={{height:6,background:'var(--db-border)',borderRadius:0}}>
        <div style={{height:6,width:pct+'%',background:cor,borderRadius:0,transition:'width .4s ease'}}/>
      </div>
    </div>
  );
}

// ── Gráfico de barras verticais (evolução mensal) ──
function GraficoMensal({ dados }) {
  if (!dados.length) return <div style={{color:'var(--db-muted)',fontSize:12,textAlign:'center',padding:'24px 0'}}>Dados insuficientes</div>;
  const maxVal = Math.max(...dados.map(d=>Math.max(d.criadas,d.resolvidas)),1);
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:8,height:120,padding:'0 4px'}}>
      {dados.map((d,i)=>(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
          <div style={{width:'100%',display:'flex',gap:2,alignItems:'flex-end',height:96}}>
            <div title={`Criadas: ${d.criadas}`} style={{flex:1,background:'#1E43F9',opacity:.7,height:Math.max(2,(d.criadas/maxVal)*96),borderRadius:'2px 2px 0 0',transition:'height .4s'}}/>
            <div title={`Resolvidas: ${d.resolvidas}`} style={{flex:1,background:'#12B76A',opacity:.8,height:Math.max(2,(d.resolvidas/maxVal)*96),borderRadius:'2px 2px 0 0',transition:'height .4s'}}/>
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:'var(--db-muted)',letterSpacing:1}}>{d.mes}</div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ sessao }) {
  const router = useRouter();
  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [perfil, setPerfil] = useState(null);

  const loadDados = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: pPerfil }] = await Promise.all([
      supabase.from('pendencias').select('*').order('created_at',{ascending:true}),
      supabase.from('user_profiles').select('*').eq('id', sessao?.user?.id).single(),
    ]);
    setPerfil(pPerfil);
    setPendencias((pData||[]).map(row=>({
      id:row.id, loja:row.loja||'', pagador:row.pagador||'',
      empreendimento:row.empreendimento||'', proposta:row.proposta||'',
      dataReceb:row.data_receb||'', valor:Number(row.valor)||0,
      tipo:row.tipo||'Documentação', status:row.status||'Pendente',
      responsavel:row.responsavel||'', acao:row.acao||'', obs:row.obs||'',
      historico:Array.isArray(row.historico)?row.historico:[],
      origem:row.origem||'manual',
    })));
    setLoading(false);
  },[sessao]);

  useEffect(()=>{ if(sessao) loadDados(); },[loadDados,sessao]);

  // ── Cálculos do dashboard ──
  const total = pendencias.length;
  const porStatus = {
    Pendente: pendencias.filter(p=>statusEfetivo(p)==='Pendente').length,
    'Em andamento': pendencias.filter(p=>statusEfetivo(p)==='Em andamento').length,
    Atrasada: pendencias.filter(p=>statusEfetivo(p)==='Atrasada').length,
    Resolvida: pendencias.filter(p=>p.status==='Resolvida').length,
  };
  const txResolucao = total>0 ? Math.round((porStatus.Resolvida/total)*100) : 0;
  const valorTotal = pendencias.reduce((a,p)=>a+p.valor,0);
  const valorPendente = pendencias.filter(p=>statusEfetivo(p)!=='Resolvida').reduce((a,p)=>a+p.valor,0);
  const valorResolvido = pendencias.filter(p=>p.status==='Resolvida').reduce((a,p)=>a+p.valor,0);

  // SLA médio de resolução
  const temposSla = [];
  pendencias.filter(p=>p.status==='Resolvida').forEach(p=>{
    const inicio = dataCriacaoDoHistorico(p.historico);
    const fim = dataResolucaoDoHistorico(p.historico);
    if (inicio&&fim) { const d=Math.round((fim-inicio)/86400000); if(d>=0) temposSla.push(d); }
  });
  const slaMedia = temposSla.length ? Math.round((temposSla.reduce((a,b)=>a+b,0)/temposSla.length)*10)/10 : null;

  // Por tipo
  const tipos = [...new Set(pendencias.map(p=>p.tipo))].sort();
  const porTipo = tipos.map(t=>({ label:t, valor:pendencias.filter(p=>p.tipo===t).length }))
    .sort((a,b)=>b.valor-a.valor);

  // Ranking de responsáveis
  const respMap = {};
  pendencias.forEach(p=>{
    if (!p.responsavel) return;
    if (!respMap[p.responsavel]) respMap[p.responsavel]={nome:p.responsavel,total:0,resolvidas:0,atrasadas:0};
    respMap[p.responsavel].total++;
    if (p.status==='Resolvida') respMap[p.responsavel].resolvidas++;
    if (statusEfetivo(p)==='Atrasada') respMap[p.responsavel].atrasadas++;
  });
  const ranking = Object.values(respMap).sort((a,b)=>b.total-a.total).slice(0,8);

  // Evolução mensal (últimos 6 meses)
  const mesesMap = {};
  pendencias.forEach(p=>{
    const dtC = dataCriacaoDoHistorico(p.historico);
    const dtR = dataResolucaoDoHistorico(p.historico);
    if (dtC) { const k=mesAno(dtC); mesesMap[k]=mesesMap[k]||{mes:'',criadas:0,resolvidas:0}; mesesMap[k].mes=k; mesesMap[k].criadas++; }
    if (dtR) { const k=mesAno(dtR); mesesMap[k]=mesesMap[k]||{mes:'',criadas:0,resolvidas:0}; mesesMap[k].mes=k; mesesMap[k].resolvidas++; }
  });
  const evolucao = Object.values(mesesMap).sort((a,b)=>a.mes.localeCompare(b.mes)).slice(-6);

  async function handleLogout() { await supabase.auth.signOut(); router.replace('/login'); }

  const CORES = { Pendente:'#FFCA03', 'Em andamento':'#1E43F9', Atrasada:'#E8334A', Resolvida:'#12B76A' };

  return (
    <>
      <Head>
        <title>Dashboard · My Broker CSC Financeiro</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
      </Head>

      {/* HEADER */}
      <div className="db-header">
        <div className="db-logo-area">
          <div className="db-logo-mark"><span>MB</span></div>
          <div>
            <div className="db-eyebrow">CSC Financeiro · Supervisão</div>
            <div className="db-title">Dashboard de Acompanhamento</div>
          </div>
        </div>
        <div className="db-header-actions">
          <button className="db-chip" onClick={()=>router.push('/')}>← Portal</button>
          <button className="db-chip" onClick={loadDados}>↻ Atualizar</button>
          <div className="db-user">
            <span>{perfil?.nome||sessao?.user?.email}</span>
            <button onClick={handleLogout} title="Sair">⏻</button>
          </div>
        </div>
      </div>

      <div className="db-body">
        {loading ? (
          <div className="db-loading">Carregando dados...</div>
        ) : (
          <>
            {/* ── FAIXA DE CARDS PRINCIPAIS ── */}
            <div className="db-kpi-row">
              <div className="db-kpi">
                <div className="db-kpi-label">Total de pendências</div>
                <div className="db-kpi-val">{total}</div>
                <div className="db-kpi-sub">todas as origens</div>
              </div>
              <div className="db-kpi danger">
                <div className="db-kpi-label">Atrasadas (SLA)</div>
                <div className="db-kpi-val">{porStatus.Atrasada}</div>
                <div className="db-kpi-sub">sem retorno em +{SLA_PADRAO_DIAS}d</div>
              </div>
              <div className="db-kpi green">
                <div className="db-kpi-label">Taxa de resolução</div>
                <div className="db-kpi-val">{txResolucao}%</div>
                <div className="db-kpi-sub">{porStatus.Resolvida} resolvidas</div>
              </div>
              <div className="db-kpi blue">
                <div className="db-kpi-label">SLA médio</div>
                <div className="db-kpi-val">{slaMedia !== null ? slaMedia+'d' : '—'}</div>
                <div className="db-kpi-sub">tempo até resolução</div>
              </div>
              <div className="db-kpi">
                <div className="db-kpi-label">Valor total</div>
                <div className="db-kpi-val sm">{fmt(valorTotal)}</div>
                <div className="db-kpi-sub">todos os lançamentos</div>
              </div>
              <div className="db-kpi amber">
                <div className="db-kpi-label">Valor pendente</div>
                <div className="db-kpi-val sm">{fmt(valorPendente)}</div>
                <div className="db-kpi-sub">aguardando resolução</div>
              </div>
            </div>

            {/* ── LINHA 2: STATUS + EVOLUÇÃO MENSAL ── */}
            <div className="db-grid-2">
              <div className="db-card">
                <div className="db-card-eyebrow">Distribuição</div>
                <div className="db-card-title">Por status</div>
                {Object.entries(porStatus).map(([s,v])=>(
                  <BarraH key={s} label={s} valor={v} total={total} cor={CORES[s]}/>
                ))}
                {/* Mini legenda visual */}
                <div style={{display:'flex',gap:12,marginTop:14,flexWrap:'wrap'}}>
                  {Object.entries(CORES).map(([s,c])=>(
                    <div key={s} style={{display:'flex',alignItems:'center',gap:4}}>
                      <div style={{width:8,height:8,background:c,flexShrink:0}}/>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,letterSpacing:1,textTransform:'uppercase',color:'var(--db-muted)'}}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="db-card">
                <div className="db-card-eyebrow">Histórico</div>
                <div className="db-card-title">Evolução mensal</div>
                <GraficoMensal dados={evolucao}/>
                <div style={{display:'flex',gap:16,marginTop:10}}>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:10,height:10,background:'#1E43F9',opacity:.7}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,letterSpacing:1,color:'var(--db-muted)'}}>CRIADAS</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:10,height:10,background:'#12B76A',opacity:.8}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,letterSpacing:1,color:'var(--db-muted)'}}>RESOLVIDAS</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── LINHA 3: TIPOS + VALOR ── */}
            <div className="db-card db-card-full">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:32}}>
                <div>
                  <div className="db-card-eyebrow">Categorias</div>
                  <div className="db-card-title">Por tipo de pendência</div>
                  {porTipo.map((t,i)=>(
                    <BarraH key={i} label={t.label} valor={t.valor} total={total} cor='#8A96B0'/>
                  ))}
                </div>
                <div>
                  <div className="db-card-eyebrow">Financeiro</div>
                  <div className="db-card-title">Valor por status</div>
                  <div style={{display:'flex',flexDirection:'column',gap:6}}>
                    {[
                      {label:'Pendente / Em andamento',val:valorPendente,cor:'#E8334A'},
                      {label:'Resolvida',val:valorResolvido,cor:'#12B76A'},
                    ].map((r,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--db-border)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{width:3,height:20,background:r.cor}}/>
                          <span style={{fontSize:12,color:'var(--db-text2)'}}>{r.label}</span>
                        </div>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:'var(--db-text)'}}>{fmt(r.val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── LINHA 4: RANKING DE RESPONSÁVEIS ── */}
            <div className="db-card db-card-full">
              <div className="db-card-eyebrow">Performance</div>
              <div className="db-card-title">Ranking de responsáveis</div>
              {ranking.length === 0
                ? <div style={{color:'var(--db-muted)',fontSize:12}}>Nenhum responsável atribuído ainda</div>
                : (
                  <div style={{overflowX:'auto'}}>
                    <table className="db-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Responsável</th>
                          <th>Total</th>
                          <th>Resolvidas</th>
                          <th>Atrasadas</th>
                          <th>Taxa resolução</th>
                          <th>Progresso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.map((r,i)=>{
                          const tx = r.total>0?Math.round((r.resolvidas/r.total)*100):0;
                          return (
                            <tr key={i}>
                              <td className="db-rank">{i+1}</td>
                              <td style={{fontWeight:600}}>{r.nome}</td>
                              <td className="db-num">{r.total}</td>
                              <td className="db-num green">{r.resolvidas}</td>
                              <td className="db-num">{r.atrasadas>0?<span className="db-atr">{r.atrasadas}</span>:'—'}</td>
                              <td className="db-num">{tx}%</td>
                              <td style={{minWidth:120}}>
                                <div style={{height:4,background:'var(--db-border)'}}>
                                  <div style={{height:4,width:tx+'%',background:'#12B76A',transition:'width .4s'}}/>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </>
        )}
      </div>

      <div className="db-footer">My Broker Imóveis · CSC Financeiro · Dashboard de Acompanhamento</div>

      <style>{`
        :root{
          --db-navy:#0D2654; --db-blue:#1E43F9; --db-yellow:#FFCA03;
          --db-text:#1A2540; --db-text2:#4A5578; --db-muted:#8A96B0;
          --db-border:#DDE2EF; --db-bg:#F4F6FB; --db-white:#fff;
          --db-green:#12B76A; --db-danger:#E8334A;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:var(--db-bg);color:var(--db-text)}

        .db-header{background:var(--db-navy);padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:3px solid var(--db-blue);position:sticky;top:0;z-index:90}
        .db-logo-area{display:flex;align-items:center;gap:12px}
        .db-logo-mark{width:34px;height:34px;background:var(--db-blue);display:flex;align-items:center;justify-content:center;clip-path:polygon(0 0,100% 0,100% 75%,50% 100%,0 75%);flex-shrink:0}
        .db-logo-mark span{font-family:'Bebas Neue',sans-serif;color:#fff;font-size:15px;letter-spacing:1px}
        .db-eyebrow{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:4px;text-transform:uppercase;color:var(--db-yellow);margin-bottom:2px}
        .db-title{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:#fff;line-height:.95}
        .db-header-actions{display:flex;gap:8px;align-items:center}
        .db-chip{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;padding:5px 12px;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.7);background:transparent;cursor:pointer;transition:all .15s}
        .db-chip:hover{border-color:var(--db-yellow);color:var(--db-yellow)}
        .db-user{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);padding:4px 10px 4px 12px;border:1px solid rgba(255,255,255,.15)}
        .db-user span{font-size:12px;font-weight:500;color:rgba(255,255,255,.8)}
        .db-user button{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);width:26px;height:26px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center}
        .db-user button:hover{background:rgba(255,255,255,.2);color:#fff}

        .db-body{padding:20px 24px;max-width:1400px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
        .db-loading{text-align:center;padding:60px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--db-muted)}

        /* KPI row */
        .db-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:3px}
        .db-kpi{background:var(--db-navy);padding:14px 16px;border-top:3px solid rgba(255,255,255,.15);position:relative;overflow:hidden}
        .db-kpi.danger{border-top-color:var(--db-danger)}
        .db-kpi.green{border-top-color:var(--db-green)}
        .db-kpi.blue{border-top-color:var(--db-blue)}
        .db-kpi.amber{border-top-color:var(--db-yellow)}
        .db-kpi-label{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:6px}
        .db-kpi-val{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:1px;color:#fff;line-height:1}
        .db-kpi-val.sm{font-size:18px;font-weight:700;font-family:'DM Sans',sans-serif}
        .db-kpi.danger .db-kpi-val{color:var(--db-danger)}
        .db-kpi.green .db-kpi-val{color:var(--db-green)}
        .db-kpi.blue .db-kpi-val{color:var(--db-blue)}
        .db-kpi.amber .db-kpi-val{color:var(--db-yellow)}
        .db-kpi-sub{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-top:4px}

        /* Cards */
        .db-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .db-card{background:var(--db-white);padding:20px;border-top:3px solid var(--db-blue);box-shadow:0 1px 3px rgba(0,0,0,.06)}
        .db-card-full{background:var(--db-white);padding:20px;border-top:3px solid var(--db-blue);box-shadow:0 1px 3px rgba(0,0,0,.06)}
        .db-card-eyebrow{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:4px;text-transform:uppercase;color:var(--db-muted);margin-bottom:4px;display:flex;align-items:center;gap:8px}
        .db-card-eyebrow::before{content:'';display:block;width:16px;height:1px;background:var(--db-blue)}
        .db-card-title{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:var(--db-text);margin-bottom:16px}

        /* Tabela ranking */
        .db-table{width:100%;border-collapse:collapse;font-size:12px;min-width:500px}
        .db-table th{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--db-muted);padding:8px 12px;border-bottom:2px solid var(--db-border);text-align:left}
        .db-table td{padding:10px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text)}
        .db-table tbody tr:hover td{background:#F9FAFE}
        .db-rank{font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--db-muted);width:32px}
        .db-num{font-family:'DM Mono',monospace;font-size:11px;text-align:right}
        .db-num.green{color:var(--db-green);font-weight:600}
        .db-atr{background:rgba(232,51,74,.1);color:var(--db-danger);padding:2px 6px;font-weight:700}

        .db-footer{background:rgba(9,47,104,.97);border-top:1px solid rgba(255,255,255,.08);padding:8px 24px;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.3);text-align:center}

        @media(max-width:768px){.db-grid-2{grid-template-columns:1fr}.db-kpi-row{grid-template-columns:1fr 1fr}}
      `}</style>
    </>
  );
}
