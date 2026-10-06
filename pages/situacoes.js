import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Situacoes({ sessao }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [lista, setLista] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [novoNome, setNovoNome] = useState('');
  const [novaDesc, setNovaDesc] = useState('');
  const [editandoId, setEditandoId] = useState(null);

  const podeGerenciar = perfil?.role === 'admin' || perfil?.role === 'gestor';

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => { if (sessao) carregar(); }, [sessao]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data: p } = await supabase.from('user_profiles').select('*').eq('id', sessao.user.id).single();
    setPerfil(p);
    const { data: all } = await supabase.from('situacoes').select('*, user_profiles(nome)').order('created_at', { ascending: false });
    setLista((all || []).filter(s => s.aprovado));
    setPendentes((all || []).filter(s => !s.aprovado));
    setLoading(false);
  }, [sessao]);

  async function sugerir() {
    if (!novoNome.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('situacoes').insert({
      nome: novoNome.trim(),
      descricao: novaDesc.trim(),
      ativo: false,
      aprovado: podeGerenciar, // admin/gestor já entra aprovado
      sugerido_por: sessao.user.id,
      sugerido_por_nome: perfil?.nome || sessao.user.email,
    });
    if (error) { showToast('Erro: ' + error.message); setSaving(false); return; }
    setNovoNome(''); setNovaDesc('');
    setSaving(false);
    await carregar();
    showToast(podeGerenciar ? 'Situação criada!' : 'Sugestão enviada para aprovação!');
  }

  async function aprovar(id) {
    await supabase.from('situacoes').update({ aprovado: true, ativo: true }).eq('id', id);
    await carregar();
    showToast('Situação aprovada e ativada!');
  }

  async function rejeitar(id) {
    if (!confirm('Rejeitar esta sugestão? Ela será excluída.')) return;
    await supabase.from('situacoes').delete().eq('id', id);
    await carregar();
    showToast('Sugestão rejeitada.');
  }

  async function toggleAtivo(s) {
    if (!podeGerenciar) return;
    await supabase.from('situacoes').update({ ativo: !s.ativo }).eq('id', s.id);
    await carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir esta situação?')) return;
    await supabase.from('situacoes').delete().eq('id', id);
    await carregar();
    showToast('Situação excluída.');
  }

  async function salvarEdicao(id, nome, desc) {
    await supabase.from('situacoes').update({ nome, descricao: desc }).eq('id', id);
    setEditandoId(null);
    await carregar();
    showToast('Atualizado!');
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 3, color: '#8A90A8' }}>
      CARREGANDO...
    </div>
  );

  return (
    <>
      <Head>
        <title>Situações · Cobrança BPO</title>
      </Head>

      <header className="hdr">
        <div className="hdr-left">
          <div className="hdr-logo">⚡</div>
          <div>
            <div className="eyebrow">Cobrança BPO · Configurações</div>
            <div className="hdr-title">Situações<span style={{ color: 'var(--signal)' }}>.</span></div>
          </div>
        </div>
        <div className="hdr-right">
          <button className="btn-ghost" onClick={() => router.push('/')}>← Voltar</button>
          <div className="user-chip">
            <span>{perfil?.nome}</span>
            <span className={'role-tag role-' + perfil?.role}>{perfil?.role}</span>
          </div>
        </div>
      </header>

      <div className="page">

        {/* FILA DE APROVAÇÃO */}
        {podeGerenciar && pendentes.length > 0 && (
          <div className="card card-alert">
            <div className="card-eyebrow">⏳ Aguardando aprovação</div>
            <div className="card-title">Sugestões pendentes ({pendentes.length})</div>
            <div className="pendentes-list">
              {pendentes.map(s => (
                <div key={s.id} className="pendente-row">
                  <div className="pendente-info">
                    <div className="pendente-nome">{s.nome}</div>
                    {s.descricao && <div className="pendente-desc">{s.descricao}</div>}
                    <div className="pendente-meta">Sugerido por {s.sugerido_por_nome} · {new Date(s.created_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <div className="pendente-actions">
                    <button className="btn-aprovar" onClick={() => aprovar(s.id)}>✓ Aprovar</button>
                    <button className="btn-rejeitar" onClick={() => rejeitar(s.id)}>✕ Rejeitar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LISTA DE SITUAÇÕES */}
        <div className="card">
          <div className="card-eyebrow">Cadastro</div>
          <div className="card-title">Situações ativas</div>
          {lista.length === 0 ? (
            <div className="empty">Nenhuma situação cadastrada ainda.</div>
          ) : (
            <div className="sit-list">
              {lista.map(s => (
                <div key={s.id} className={'sit-row' + (s.ativo ? '' : ' inativo')}>
                  {editandoId === s.id ? (
                    <EditRow s={s} onSave={salvarEdicao} onCancel={() => setEditandoId(null)} />
                  ) : (
                    <>
                      <div className="sit-info">
                        <div className="sit-nome">{s.nome}</div>
                        {s.descricao && <div className="sit-desc">{s.descricao}</div>}
                      </div>
                      <div className="sit-status">
                        <span className={s.ativo ? 'tag-ativo' : 'tag-inativo'}>{s.ativo ? 'ativa' : 'inativa'}</span>
                      </div>
                      {podeGerenciar && (
                        <div className="sit-actions">
                          <button className="icon-btn" onClick={() => setEditandoId(s.id)} title="Editar">✏</button>
                          <button className="icon-btn" onClick={() => toggleAtivo(s)} title={s.ativo ? 'Desativar' : 'Ativar'}>{s.ativo ? '⊘' : '✓'}</button>
                          {perfil?.role === 'admin' && <button className="icon-btn danger" onClick={() => excluir(s.id)} title="Excluir">✕</button>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* FORMULÁRIO DE SUGESTÃO/CRIAÇÃO */}
        <div className="card">
          <div className="card-eyebrow">{podeGerenciar ? 'Nova situação' : 'Sugerir situação'}</div>
          <div className="card-title">{podeGerenciar ? 'Criar situação' : 'Enviar sugestão para aprovação'}</div>
          {!podeGerenciar && (
            <div className="info-box">Sua sugestão será enviada para aprovação de um gestor ou admin antes de aparecer nas opções.</div>
          )}
          <div className="form-col">
            <div className="fg">
              <label>Nome da situação *</label>
              <input type="text" placeholder="Ex: Em mediação, Acordo parcial..." value={novoNome} onChange={e => setNovoNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && sugerir()} />
            </div>
            <div className="fg">
              <label>Descrição (opcional)</label>
              <input type="text" placeholder="O que significa esta situação?" value={novaDesc} onChange={e => setNovaDesc(e.target.value)} />
            </div>
            <button className="btn-accent" onClick={sugerir} disabled={saving || !novoNome.trim()}>
              {saving ? 'Salvando...' : podeGerenciar ? '+ Criar situação' : '→ Enviar sugestão'}
            </button>
          </div>
        </div>
      </div>

      <div className={'toast' + (toast ? ' show' : '')}>{toast}</div>

      <style>{`
        :root{--bg:#0F1117;--surface:#1A1D27;--surface2:#22263A;--border:#2A2D3A;--signal:oklch(0.656 0.231 29.3);--paid:oklch(0.603 0.136 159.3);--late:oklch(0.573 0.212 23.8);--text:#E8EAF0;--text2:#B8BDD0;--muted:#8A90A8;}
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:var(--font-display,'Archivo',sans-serif);background:var(--bg);color:var(--text)}
        .hdr{background-color:var(--surface);background-image:repeating-linear-gradient(-58deg,transparent 0 10px,oklch(0.656 0.231 29.3/10%) 10px 12px);border-bottom:1px solid var(--border);padding:0 24px;height:54px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:90}
        .hdr-left{display:flex;align-items:center;gap:12px}
        .hdr-logo{width:34px;height:34px;background:var(--signal);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
        .eyebrow{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
        .hdr-title{font-size:16px;font-weight:800;color:var(--text)}
        .hdr-right{display:flex;align-items:center;gap:8px}
        .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text2);padding:5px 12px;font-size:11px;cursor:pointer;font-family:var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:1px;transition:all .15s}
        .btn-ghost:hover{border-color:var(--signal);color:var(--signal)}
        .btn-accent{background:var(--signal);color:#fff;border:none;padding:10px 20px;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .15s;align-self:flex-start}
        .btn-accent:hover{opacity:.85}
        .btn-accent:disabled{opacity:.5;cursor:not-allowed}
        .user-chip{display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);padding:4px 10px 4px 12px}
        .user-chip span{font-size:12px;font-weight:500}
        .role-tag{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:2px;text-transform:uppercase;padding:2px 6px}
        .role-admin{background:oklch(0.656 0.231 29.3/0.2);color:var(--signal)}
        .role-gestor{background:rgba(129,140,248,.2);color:#818CF8}
        .role-operador{background:rgba(255,255,255,.08);color:var(--text2)}
        .page{max-width:760px;margin:24px auto;padding:0 24px;display:flex;flex-direction:column;gap:16px}
        .card{background:var(--surface);border:1px solid var(--border);border-top:2px solid var(--signal);padding:24px}
        .card-alert{border-top-color:oklch(0.707 0.156 67.0)}
        .card-eyebrow{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
        .card-title{font-size:18px;font-weight:800;margin-bottom:18px}
        .empty{font-size:12px;color:var(--muted);font-style:italic;text-align:center;padding:20px;border:1px dashed var(--border);background-image:repeating-linear-gradient(-58deg,transparent 0 9px,oklch(0.656 0.231 29.3/5%) 9px 10px)}
        .info-box{background:oklch(0.707 0.156 67.0/0.1);border-left:3px solid oklch(0.707 0.156 67.0);padding:10px 14px;font-size:12px;color:oklch(0.707 0.156 67.0);margin-bottom:16px}

        /* Pendentes */
        .pendentes-list{display:flex;flex-direction:column;gap:8px}
        .pendente-row{display:flex;align-items:center;gap:12px;padding:12px;background:oklch(0.707 0.156 67.0/0.06);border:1px solid oklch(0.707 0.156 67.0/0.2)}
        .pendente-info{flex:1}
        .pendente-nome{font-size:13px;font-weight:600;color:var(--text)}
        .pendente-desc{font-size:11px;color:var(--text2);margin-top:2px}
        .pendente-meta{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:9px;color:var(--muted);margin-top:4px;letter-spacing:1px}
        .pendente-actions{display:flex;gap:6px;flex-shrink:0}
        .btn-aprovar{background:var(--paid);color:#fff;border:none;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:opacity .15s}
        .btn-aprovar:hover{opacity:.85}
        .btn-rejeitar{background:transparent;border:1px solid var(--late);color:var(--late);padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s}
        .btn-rejeitar:hover{background:oklch(0.573 0.212 23.8/0.1)}

        /* Lista situações */
        .sit-list{display:flex;flex-direction:column;gap:6px}
        .sit-row{display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--surface2);border:1px solid var(--border);transition:background .15s}
        .sit-row:hover{background:#2A2D3A}
        .sit-row.inativo{opacity:.45}
        .sit-info{flex:1}
        .sit-nome{font-size:13px;font-weight:500;color:var(--text)}
        .sit-desc{font-size:11px;color:var(--text2);margin-top:2px}
        .sit-status{flex-shrink:0}
        .tag-ativo{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--paid)}
        .tag-inativo{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
        .sit-actions{display:flex;gap:4px;flex-shrink:0}
        .icon-btn{background:none;border:1px solid var(--border);color:var(--muted);width:28px;height:28px;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
        .icon-btn:hover{border-color:var(--signal);color:var(--signal)}
        .icon-btn.danger:hover{border-color:var(--late);color:var(--late)}

        /* Form */
        .form-col{display:flex;flex-direction:column;gap:12px}
        .fg{display:flex;flex-direction:column;gap:5px}
        .fg label{font-family:var(--font-mono,'IBM Plex Mono',monospace);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
        .fg input{background:#13161F;border:1px solid #1E2130;color:var(--text);padding:9px 12px;font-size:12px;transition:border-color .15s}
        .fg input:focus{outline:none;border-color:var(--signal)}

        /* Edit row */
        .edit-row{display:flex;align-items:center;gap:8px;flex:1}
        .edit-input{background:#13161F;border:1px solid var(--signal);color:var(--text);padding:6px 10px;font-size:12px;flex:1}
        .edit-input:focus{outline:none}
        .btn-save{background:var(--signal);color:#fff;border:none;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer}
        .btn-cancel{background:transparent;border:1px solid var(--border);color:var(--muted);padding:6px 12px;font-size:11px;cursor:pointer}

        /* Toast */
        .toast{position:fixed;bottom:24px;right:24px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--signal);color:var(--text);padding:12px 20px;font-size:12px;opacity:0;transform:translateY(10px);transition:all .25s;pointer-events:none;z-index:999}
        .toast.show{opacity:1;transform:translateY(0)}
      `}</style>
    </>
  );
}

function EditRow({ s, onSave, onCancel }) {
  const [nome, setNome] = useState(s.nome);
  const [desc, setDesc] = useState(s.descricao || '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
      <input className="edit-input" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome" />
      <input className="edit-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Descrição" style={{ flex: 1.5 }} />
      <button className="btn-save" onClick={() => onSave(s.id, nome, desc)}>Salvar</button>
      <button className="btn-cancel" onClick={onCancel}>Cancelar</button>
    </div>
  );
}
